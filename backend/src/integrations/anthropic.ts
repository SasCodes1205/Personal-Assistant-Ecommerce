import Anthropic from '@anthropic-ai/sdk';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../db/prisma.js';

export const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export type ClaudeCallParams = {
  agent: string;
  model: string;
  system: string | Anthropic.Messages.TextBlockParam[];
  messages: Anthropic.Messages.MessageParam[];
  maxTokens?: number;
  temperature?: number;
  resultRefId?: string;
  toolChoice?: Anthropic.Messages.ToolChoice;
  tools?: Anthropic.Messages.Tool[];
};

/**
 * Run a Claude message with audit logging and prompt caching on the system block.
 *
 * IMPORTANT — prompt caching:
 *   Mark large stable blocks with { type: 'ephemeral' } cache_control on the LAST
 *   block of the cached section. The CEO context block + agent system prompt should
 *   always be cached. This gives ~90% cost reduction on repeat calls.
 */
export async function runClaude(params: ClaudeCallParams) {
  const {
    agent,
    model,
    system,
    messages,
    maxTokens = 4096,
    temperature = 0.7,
    resultRefId,
    toolChoice,
    tools,
  } = params;

  const systemBlocks: Anthropic.Messages.TextBlockParam[] =
    typeof system === 'string'
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : system;

  const t0 = Date.now();
  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemBlocks,
      messages,
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    });

    const ms = Date.now() - t0;
    const usage = response.usage;

    logger.info(
      {
        agent,
        model,
        ms,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens,
        cacheCreateTokens: usage.cache_creation_input_tokens,
      },
      'claude.call'
    );

    // Fire-and-forget audit write
    prisma.auditLog
      .create({
        data: {
          eventType: 'claude_call',
          agent,
          model,
          promptTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cachedTokens: usage.cache_read_input_tokens ?? 0,
          resultRefId,
          payload: {
            stopReason: response.stop_reason,
            ms,
          },
        },
      })
      .catch((err) => logger.error({ err }, 'audit write failed'));

    return response;
  } catch (err) {
    logger.error({ err, agent, model }, 'claude.error');
    throw err;
  }
}

/** Extract first text block from response. */
export function getText(response: Anthropic.Messages.Message): string {
  for (const block of response.content) {
    if (block.type === 'text') return block.text;
  }
  return '';
}

/** Extract first tool_use block (for structured-output flows using forced tool use). */
export function getToolUse<T = unknown>(
  response: Anthropic.Messages.Message
): { name: string; input: T } | null {
  for (const block of response.content) {
    if (block.type === 'tool_use') {
      return { name: block.name, input: block.input as T };
    }
  }
  return null;
}
