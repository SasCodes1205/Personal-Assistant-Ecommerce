import type Anthropic from '@anthropic-ai/sdk';
import { runClaude, getToolUse } from '../integrations/anthropic.js';
import { env } from '../lib/env.js';
import { buildSystem } from '../prompts/ceo-context.js';

/**
 * Compliance auto-reviewer (Master Plan Section 6 — pulled forward into Phase 1).
 *
 * A MANDATORY checkpoint that classifies any claim-bearing copy into three
 * publication zones BEFORE it reaches the approval queue:
 *
 *   GREEN  — CS replies, shipping, internal notes, routine alerts. Pass.
 *   YELLOW — structure/function language, product/ingredient claims, marketing
 *            copy. Requires the FDA disclaimer + human review.
 *   RED    — disease/treatment claims, "proven"/cure, before/after, medical
 *            comparison, testimonial implying treatment results. BLOCK.
 *
 * This agent REDUCES risk; it does not replace qualified regulatory counsel.
 * Final labels, claims, and advertising still require a supplement attorney.
 */

export const FDA_DISCLAIMER =
  'This statement has not been evaluated by the Food and Drug Administration. ' +
  'This product is not intended to diagnose, treat, cure, or prevent any disease.';

const REVIEWER_INSTRUCTIONS = `
You are the COMPLIANCE GATEKEEPER for a US dietary-supplement brand (NUTRITUNES)
and a food-ingredient distributor (Ceylon Nutritionals). You enforce FDA (DSHEA,
21 CFR 111) and FTC advertising rules. You classify a piece of copy into one zone.

CLASSIFY INTO EXACTLY ONE ZONE:

GREEN — No health/efficacy claims at all. Customer-service replies, shipping/order
  updates, scheduling, internal notes, routine operational messages, B2B logistics
  that make no health claim. Safe to proceed after normal human approval.

YELLOW — Contains structure/function language or product/ingredient claims that are
  permissible IF substantiated and disclaimed. Examples: "supports healthy blood
  sugar already in the normal range", "antioxidant support", describing Ceylon
  cinnamon's low coumarin vs Cassia as a factual compositional difference. These
  require: (a) the standard FDA disclaimer appended, (b) competent and reliable
  scientific substantiation on file, and (c) human review. Set disclaimerRequired=true.

RED — Disease or symptom-treatment claims, or otherwise non-compliant. Examples:
  "treats/cures/prevents diabetes", "lowers blood sugar in diabetics", "reduces
  inflammation from arthritis", "clinically proven to cure", before/after implications,
  medical comparisons ("works like metformin"), or testimonials implying treatment
  results. Also RED: any claim of hepatotoxicity benefit framed as treating liver
  disease. BLOCK — must never auto-send or auto-publish.

RULES:
- Judge the NET IMPRESSION a reader takes away, not just literal words (FTC standard).
- A 1:1 reply that defers a health question ("happy to share our clinical evidence
  summary separately") is GREEN — no claim is made.
- If uncertain between YELLOW and RED, choose RED. Compliance is never sacrificed.
- For each flag, name the specific issue and the rule it implicates.
- disclaimerRequired must be true for YELLOW, false for GREEN, and is irrelevant
  for RED (the copy must be rewritten by a human regardless).
`.trim();

const reviewTool: Anthropic.Messages.Tool = {
  name: 'classify_compliance',
  description: 'Classify copy into a compliance publication zone with flags.',
  input_schema: {
    type: 'object',
    properties: {
      zone: { type: 'string', enum: ['GREEN', 'YELLOW', 'RED'] },
      disclaimerRequired: { type: 'boolean' },
      flags: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            issue: { type: 'string', description: 'The specific phrase or claim' },
            rule: { type: 'string', description: 'The FDA/FTC rule implicated' },
            severity: { type: 'string', enum: ['info', 'warning', 'block'] },
          },
          required: ['issue', 'rule', 'severity'],
        },
      },
      reasoning: { type: 'string', description: 'One or two sentences.' },
    },
    required: ['zone', 'disclaimerRequired', 'flags', 'reasoning'],
  },
};

export type ComplianceResult = {
  zone: 'GREEN' | 'YELLOW' | 'RED';
  disclaimerRequired: boolean;
  flags: { issue: string; rule: string; severity: 'info' | 'warning' | 'block' }[];
  reasoning: string;
};

/**
 * Review a piece of copy. `context` describes what it is (e.g. "1:1 email reply
 * to a known B2B contact" vs "Amazon product description") — this materially
 * affects the net-impression judgment.
 */
export async function reviewCompliance(
  copy: string,
  context: string,
  resultRefId?: string
): Promise<ComplianceResult> {
  const response = await runClaude({
    agent: 'ComplianceReviewer',
    model: env.MODEL_COMPLIANCE,
    system: buildSystem(REVIEWER_INSTRUCTIONS),
    messages: [
      {
        role: 'user',
        content: `CONTEXT: ${context}\n\nCOPY TO REVIEW:\n"""\n${copy}\n"""\n\nClassify it now using the classify_compliance tool.`,
      },
    ],
    tools: [reviewTool],
    toolChoice: { type: 'tool', name: 'classify_compliance' },
    maxTokens: 1024,
    temperature: 0,
    resultRefId,
  });

  const result = getToolUse<ComplianceResult>(response);
  if (!result) {
    // Fail CLOSED: if the reviewer didn't return, treat as RED (block).
    return {
      zone: 'RED',
      disclaimerRequired: false,
      flags: [{ issue: 'Reviewer returned no result', rule: 'fail-closed policy', severity: 'block' }],
      reasoning: 'Compliance reviewer did not return a classification; blocking by default.',
    };
  }
  return result.input;
}
