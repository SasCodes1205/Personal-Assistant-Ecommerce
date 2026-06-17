import { Hono } from 'hono';
import { prisma } from '../db/prisma.js';
import { verifyWebhookAuth } from '../integrations/assemblyai.js';
import { extractMeeting } from '../agents/meeting-extractor.js';
import { triageEmail } from '../agents/email-triage.js';
import { generateDraft } from '../agents/email-drafter.js';
import { getMessage } from '../integrations/graph-mail.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

export const webhooksRouter = new Hono();

/**
 * AssemblyAI completion webhook (FALLBACK transcription path).
 * Unchanged: verifies the shared secret, then kicks off extraction.
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

  if (body.status === 'error') {
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'FAILED', errorMessage: body.error ?? 'AssemblyAI error' },
    });
    return c.json({ ok: true });
  }
  if (body.status === 'completed') {
    extractMeeting(meetingId).catch((err) => logger.error({ err, meetingId }, 'extraction failed'));
  }
  return c.json({ ok: true });
});

/**
 * Microsoft Graph change-notification webhook (replaces Gmail Pub/Sub).
 *
 * 1) VALIDATION HANDSHAKE: on subscription creation, Graph calls this URL with a
 *    ?validationToken=... query param. We MUST echo it back as text/plain, 200,
 *    within 10 seconds, or the subscription won't be created.
 * 2) NOTIFICATION: Graph POSTs { value: [{ resourceData: { id }, clientState }] }.
 *    We verify clientState, fetch the new message, persist + triage + draft.
 */
webhooksRouter.post('/graph', async (c) => {
  // 1. Validation handshake
  const validationToken = c.req.query('validationToken');
  if (validationToken) {
    logger.info('graph.subscription.validation');
    return c.text(validationToken, 200, { 'Content-Type': 'text/plain' });
  }

  // 2. Notification
  const body = await c.req.json().catch(() => ({}));
  const notifications: any[] = body.value ?? [];

  // Respond 202 fast; process asynchronously so we never block Graph.
  for (const n of notifications) {
    if (n.clientState !== env.GRAPH_SUBSCRIPTION_CLIENT_STATE) {
      logger.warn('graph.notification.bad_client_state');
      continue;
    }
    const messageId = n.resourceData?.id;
    if (!messageId) continue;

    ingestMessage(messageId).catch((err) =>
      logger.error({ err, messageId }, 'graph.ingest.failed')
    );
  }

  return c.body(null, 202);
});

/**
 * Graph lifecycle notifications (reauthorizationRequired / subscriptionRemoved /
 * missed). Lets us recover by renewing or recreating the subscription.
 */
webhooksRouter.post('/graph-lifecycle', async (c) => {
  const validationToken = c.req.query('validationToken');
  if (validationToken) return c.text(validationToken, 200, { 'Content-Type': 'text/plain' });

  const body = await c.req.json().catch(() => ({}));
  for (const n of body.value ?? []) {
    logger.warn({ lifecycleEvent: n.lifecycleEvent }, 'graph.lifecycle');
    // Renewal/recreate is handled by the daily cron via ensureMailSubscription().
  }
  return c.body(null, 202);
});

/**
 * Shared ingestion: fetch a Graph message, upsert, triage, conditionally draft.
 * Reused by the webhook and the polling fallback / manual backfill.
 */
export async function ingestMessage(providerMessageId: string) {
  const msg = await getMessage(providerMessageId);

  const email = await prisma.email.upsert({
    where: { providerMessageId: msg.providerMessageId },
    create: {
      providerMessageId: msg.providerMessageId,
      providerThreadId: msg.providerThreadId,
      from: msg.from,
      fromName: msg.fromName,
      to: msg.to,
      subject: msg.subject,
      bodyText: msg.bodyText,
      bodyHtml: msg.bodyHtml,
      receivedAt: msg.receivedAt,
    },
    update: {},
  });

  const triage = await triageEmail(email.id);
  if (triage.needsDraft && triage.category !== 'SPAM') {
    await generateDraft(email.id).catch((err) =>
      logger.error({ err, emailId: email.id }, 'draft failed')
    );
  }
  return { emailId: email.id, triage };
}

/** Manual ingest endpoint (testing / backfill). Protected by internal secret. */
webhooksRouter.post('/graph/ingest', async (c) => {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${env.INTERNAL_API_SECRET}`) return c.json({ error: 'unauthorized' }, 401);

  const { messageId } = await c.req.json();
  if (!messageId) return c.json({ error: 'messageId required' }, 400);
  const result = await ingestMessage(messageId);
  return c.json(result);
});
