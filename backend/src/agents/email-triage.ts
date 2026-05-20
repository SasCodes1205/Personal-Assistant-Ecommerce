import type Anthropic from '@anthropic-ai/sdk';
import { runClaude, getToolUse } from '../integrations/anthropic.js';
import { env } from '../lib/env.js';
import { buildSystem } from '../prompts/ceo-context.js';
import { prisma } from '../db/prisma.js';

const TRIAGE_INSTRUCTIONS = `
You are the email triage agent. For every incoming email, you classify it
along three dimensions and return STRUCTURED OUTPUT via the classify tool.

CATEGORIES (pick ONE):
- VIP            : From the CEO's VIP list (legal, board, family, top buyers)
- URGENT         : Time-sensitive, needs CEO attention within hours
- VENDOR_OPS     : Vendor invoices, ops messages, routine business
- CUSTOMER       : NUtritunes customer support, complaints, questions
- NEWSLETTER_FYI : Newsletters, FYI updates, no action required
- SPAM           : Promotional, low-quality, or junk

BUSINESS UNIT:
- NUTRITUNES, CEYLON_NUTRITIONALS, PERSONAL, or UNKNOWN

NEEDS DRAFT:
- true if a reply is appropriate AND can be drafted without external info
- false for newsletters, spam, FYI, or things requiring CEO judgment from data
  you don't have

Reasoning: 1-2 sentences max. State the SIGNAL that drove your call.
Be conservative on VIP — only mark VIP if you have evidence the sender is on the
CEO's VIP list (you'll be given the list).
`.trim();

const tool: Anthropic.Messages.Tool = {
  name: 'classify',
  description: 'Classify the incoming email and decide whether a reply draft is needed.',
  input_schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['VIP', 'URGENT', 'VENDOR_OPS', 'CUSTOMER', 'NEWSLETTER_FYI', 'SPAM'],
      },
      businessUnit: {
        type: 'string',
        enum: ['NUTRITUNES', 'CEYLON_NUTRITIONALS', 'PERSONAL', 'UNKNOWN'],
      },
      needsDraft: { type: 'boolean' },
      reasoning: { type: 'string', maxLength: 280 },
    },
    required: ['category', 'businessUnit', 'needsDraft', 'reasoning'],
  },
};

export type TriageResult = {
  category: 'VIP' | 'URGENT' | 'VENDOR_OPS' | 'CUSTOMER' | 'NEWSLETTER_FYI' | 'SPAM';
  businessUnit: 'NUTRITUNES' | 'CEYLON_NUTRITIONALS' | 'PERSONAL' | 'UNKNOWN';
  needsDraft: boolean;
  reasoning: string;
};

export async function triageEmail(emailId: string): Promise<TriageResult> {
  const email = await prisma.email.findUniqueOrThrow({ where: { id: emailId } });
  const vips = await prisma.vipContact.findMany();
  const vipList = vips.length
    ? vips.map((v) => `- ${v.email} (${v.name}, ${v.relationship})`).join('\n')
    : '(no VIPs configured yet)';

  const userMessage = `
CEO VIP LIST:
${vipList}

INCOMING EMAIL:
From: ${email.fromName ?? ''} <${email.from}>
To: ${email.to}
Subject: ${email.subject}
Received: ${email.receivedAt.toISOString()}

---
${email.bodyText.slice(0, 8000)}
---

Classify this email.
`.trim();

  const response = await runClaude({
    agent: 'EmailTriage',
    model: env.MODEL_TRIAGE,
    system: buildSystem(TRIAGE_INSTRUCTIONS),
    messages: [{ role: 'user', content: userMessage }],
    tools: [tool],
    toolChoice: { type: 'tool', name: 'classify' },
    maxTokens: 1024,
    temperature: 0.1,
    resultRefId: emailId,
  });

  const result = getToolUse<TriageResult>(response);
  if (!result) throw new Error('Triage agent did not return tool_use');

  await prisma.email.update({
    where: { id: emailId },
    data: {
      category: result.input.category,
      businessUnit: result.input.businessUnit,
      isVip: result.input.category === 'VIP',
      triageReasoning: result.input.reasoning,
    },
  });

  return result.input;
}
