import { runClaude, getText } from '../integrations/anthropic.js';
import { env } from '../lib/env.js';
import { buildSystem } from '../prompts/ceo-context.js';
import { prisma } from '../db/prisma.js';
import { createDraft } from '../integrations/gmail.js';

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
  status: 'DRAFTED' | 'NO_DRAFT';
  draftId?: string;
  reason?: string;
}> {
  const email = await prisma.email.findUniqueOrThrow({
    where: { id: emailId },
  });

  // Pull last 3 messages in thread for context (if any)
  const threadHistory = await prisma.email.findMany({
    where: { gmailThreadId: email.gmailThreadId, id: { not: emailId } },
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

  const text = getText(response).trim();

  if (text.startsWith('NO_DRAFT:')) {
    return { status: 'NO_DRAFT', reason: text.replace('NO_DRAFT:', '').trim() };
  }

  // Create the Gmail draft
  const subject = email.subject.toLowerCase().startsWith('re:')
    ? email.subject
    : `Re: ${email.subject}`;

  const gmailDraft = await createDraft({
    to: email.from,
    subject,
    body: text,
    threadId: email.gmailThreadId,
  });

  const draft = await prisma.draft.create({
    data: {
      emailId,
      bodyText: text,
      modelUsed: env.MODEL_DRAFT,
      status: 'PENDING_REVIEW',
      // Store gmail draft id in compliance flags JSON for now; add dedicated col later
      complianceFlags: { gmailDraftId: gmailDraft.id },
    },
  });

  return { status: 'DRAFTED', draftId: draft.id };
}
