import { runClaude, getText } from '../integrations/anthropic.js';
import { env } from '../lib/env.js';
import { buildSystem } from '../prompts/ceo-context.js';
import { prisma } from '../db/prisma.js';
import { createDraft } from '../integrations/graph-mail.js';
import { reviewCompliance, FDA_DISCLAIMER } from './compliance-reviewer.js';

const DRAFTER_INSTRUCTIONS = `
You are the email reply drafter. You write reply drafts in the CEO's voice.
Drafts are NEVER sent automatically — the CEO reviews and approves every one.

CEO VOICE GUIDELINES:
- Direct. Often 2-4 sentences.
- Warm but professional. No flattery, no excessive pleasantries.
- Uses short paragraphs.
- Closes with first name only: "Nalin"
- Signs off with "Best," or "Thanks," depending on warmth needed.

OUTPUT FORMAT:
Return ONLY the body text of the reply. No subject line, no headers, no greeting
to "the CEO". Start directly with the greeting line (e.g. "Hi Sarah,").

REGULATORY GUARDRAILS (CRITICAL):
- If the email asks about supplement health benefits or ingredient claims and your
  reply would include such claims, you must NOT make disease claims.
  Structure/function claims are OK only with the FDA disclaimer if the reply is
  customer-facing marketing. For 1:1 emails to known recipients (B2B contacts,
  partners), avoid making any specific health claims in writing — defer with
  "Happy to share our clinical evidence summary — sending separately."
- For Ceylon Nutritionals B2B emails: cite Ceylon vs Cassia coumarin difference only
  factually (low coumarin in Ceylon, EU Reg 1334/2008). Do not extrapolate to
  hepatotoxicity claims in customer emails.
- If you detect a request to commit to pricing, deliverables, or claims that
  require CEO judgment, write a HOLDING reply: acknowledge + state you will revert
  by a specific time. Do NOT invent commitments.

If the email does not warrant a reply OR you cannot draft a high-quality reply
without information you don't have, respond with exactly:
NO_DRAFT: <one sentence reason>
`.trim();

export async function generateDraft(emailId: string): Promise<{
  status: 'DRAFTED' | 'NO_DRAFT' | 'BLOCKED';
  draftId?: string;
  zone?: string;
  reason?: string;
}> {
  const email = await prisma.email.findUniqueOrThrow({ where: { id: emailId } });

  // Pull last 3 messages in thread for context (if any)
  const threadHistory = await prisma.email.findMany({
    where: { providerThreadId: email.providerThreadId, id: { not: emailId } },
    orderBy: { receivedAt: 'desc' },
    take: 3,
  });

  const threadContext = threadHistory.length
    ? `\n\nPRIOR THREAD MESSAGES (most recent first):\n${threadHistory
        .map((m) => `--- From: ${m.from} | ${m.receivedAt.toISOString()}\n${m.bodyText.slice(0, 1500)}`)
        .join('\n\n')}`
    : '';

  const userMessage = `
INCOMING EMAIL TO REPLY TO:
From: ${email.fromName ?? ''} <${email.from}>
Subject: ${email.subject}
Category: ${email.category} | Business unit: ${email.businessUnit}

${email.bodyText.slice(0, 8000)}
${threadContext}

Draft the reply now.
`.trim();

  const response = await runClaude({
    agent: 'EmailDrafter',
    model: env.MODEL_DRAFT,
    system: buildSystem(DRAFTER_INSTRUCTIONS),
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 2048,
    temperature: 0.6,
    resultRefId: emailId,
  });

  let text = getText(response).trim();

  if (text.startsWith('NO_DRAFT:')) {
    return { status: 'NO_DRAFT', reason: text.replace('NO_DRAFT:', '').trim() };
  }

  // ── COMPLIANCE GATE (Master Plan Section 6) ──────────────────────────────
  // Every claim-bearing draft is scanned BEFORE it reaches the approval queue.
  const compliance = await reviewCompliance(
    text,
    `1:1 outbound email reply for ${email.businessUnit}; recipient category ${email.category}`,
    emailId
  );

  // YELLOW: append the FDA disclaimer if it's not already present.
  if (
    compliance.zone === 'YELLOW' &&
    compliance.disclaimerRequired &&
    !text.includes('has not been evaluated by the Food and Drug Administration')
  ) {
    text = `${text}\n\n---\n${FDA_DISCLAIMER}`;
  }

  // RED: block. Persist an AUTO_REJECTED draft for the audit trail; do NOT create
  // an Outlook draft. The CEO sees it flagged in the dashboard, never sends it.
  if (compliance.zone === 'RED') {
    const blocked = await prisma.draft.create({
      data: {
        emailId,
        bodyText: text,
        modelUsed: env.MODEL_DRAFT,
        status: 'AUTO_REJECTED',
        complianceZone: 'RED',
        complianceFlags: compliance as any,
      },
    });
    await prisma.auditLog.create({
      data: {
        eventType: 'draft_auto_rejected',
        agent: 'ComplianceReviewer',
        resultRefId: blocked.id,
        payload: compliance as any,
      },
    });
    return { status: 'BLOCKED', draftId: blocked.id, zone: 'RED', reason: compliance.reasoning };
  }

  // GREEN / YELLOW: create the Outlook draft (lands in CEO's Drafts folder).
  const subject = email.subject.toLowerCase().startsWith('re:')
    ? email.subject
    : `Re: ${email.subject}`;

  const { providerDraftId } = await createDraft({
    replyToMessageId: email.providerMessageId,
    body: text,
  });

  const draft = await prisma.draft.create({
    data: {
      emailId,
      bodyText: text,
      modelUsed: env.MODEL_DRAFT,
      status: 'PENDING_REVIEW',
      providerDraftId,
      complianceZone: compliance.zone, // GREEN or YELLOW
      complianceFlags: compliance as any,
    },
  });

  return { status: 'DRAFTED', draftId: draft.id, zone: compliance.zone };
}
