import { Hono } from 'hono';
import { prisma } from '../db/prisma.js';
import { verifyWebhookAuth } from '../integrations/assemblyai.js';
import { extractMeeting } from '../agents/meeting-extractor.js';
import { triageEmail } from '../agents/email-triage.js';
import { generateDraft } from '../agents/email-drafter.js';
import { getMessage, extractBodies, getHeader } from '../integrations/gmail.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

export const webhooksRouter = new Hono();

/**
 * AssemblyAI completion webhook.
 * Fires when a transcript finishes. We verify the shared secret and then
 * kick off Claude extraction.
 *
 * Expected: ?meetingId=<id> query param + body { transcript_id, status }
 */
webhooksRouter.post('/assemblyai', async (c) => {
  const authHeader = c.req.header(env.ASSEMBLYAI_WEBHOOK_AUTH_HEADER);
  if (!verifyWebhookAuth(authHeader)) {
    logger.warn('Invalid AssemblyAI webhook auth');
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = await c.req.json();
  const meetingId = c.req.query('meetingId');
  if (!meetingId) return c.json({ error: 'missing meetingId' }, 400);

  logger.info({ meetingId, status: body.status }, 'assemblyai.webhook');

  if (body.status === 'error') {
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'FAILED', errorMessage: body.error ?? 'AssemblyAI error' },
    });
    return c.json({ ok: true });
  }

  if (body.status === 'completed') {
    // Run extraction inline for MVP; for scale, emit Inngest event instead.
    extractMeeting(meetingId).catch((err) =>
      logger.error({ err, meetingId }, 'extraction failed')
    );
  }

  return c.json({ ok: true });
});

/**
 * Gmail Pub/Sub push webhook.
 * Google posts { message: { data: base64({ emailAddress, historyId }) } }
 *
 * For each new message in history, we fetch it, persist it, triage, and
 * (if eligible) draft a reply.
 */
webhooksRouter.post('/gmail', async (c) => {
  // Note: production should also verify the Google-issued OIDC JWT in the
  // Authorization header against your Pub/Sub service-account audience.
  const body = await c.req.json();
  const data = body?.message?.data;
  if (!data) return c.json({ error: 'no message' }, 400);

  const decoded = JSON.parse(Buffer.from(data, 'base64').toString('utf-8'));
  logger.info({ decoded }, 'gmail.pubsub');

  // For MVP, just process the most recent unread inbox messages.
  // Production: track lastHistoryId and use users.history.list for the diff.
  // Here we just acknowledge — actual ingestion happens via /gmail/poll
  return c.json({ ok: true });
});

/**
 * Manual poll endpoint to ingest a specific Gmail message.
 * Useful for testing and for the initial backfill before Push is configured.
 */
webhooksRouter.post('/gmail/ingest', async (c) => {
  const { messageId } = await c.req.json();
  if (!messageId) return c.json({ error: 'messageId required' }, 400);

  const msg = await getMessage(messageId);
  const { text, html } = extractBodies(msg);

  const email = await prisma.email.upsert({
    where: { gmailMessageId: messageId },
    create: {
      gmailMessageId: messageId,
      gmailThreadId: msg.threadId ?? messageId,
      from: getHeader(msg, 'From') ?? '',
      to: getHeader(msg, 'To') ?? '',
      subject: getHeader(msg, 'Subject') ?? '(no subject)',
      bodyText: text,
      bodyHtml: html,
      receivedAt: new Date(parseInt(msg.internalDate ?? '0', 10)),
    },
    update: {},
  });

  // Triage, then conditionally draft
  const triage = await triageEmail(email.id);
  if (triage.needsDraft && triage.category !== 'SPAM') {
    await generateDraft(email.id).catch((err) =>
      logger.error({ err, emailId: email.id }, 'draft failed')
    );
  }

  return c.json({ emailId: email.id, triage });
});
