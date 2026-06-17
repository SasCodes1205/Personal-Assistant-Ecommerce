import { Hono } from 'hono';
import { prisma } from '../db/prisma.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import {
  ensureMailSubscription,
  listSubscriptions,
} from '../integrations/graph-subscriptions.js';

export const subscriptionsRouter = new Hono();

function requireInternalAuth(authHeader?: string): boolean {
  return authHeader === `Bearer ${env.INTERNAL_API_SECRET}`;
}

/**
 * Create-or-renew the Graph mail subscription. Idempotent.
 * Called by the DAILY renewal cron (mail subscriptions expire in <3 days).
 */
subscriptionsRouter.post('/mail/ensure', async (c) => {
  if (!requireInternalAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const subscriptionId = await ensureMailSubscription();

  // Persist for visibility/debugging
  const subs = await listSubscriptions();
  const mine = subs.find((s) => s.id === subscriptionId);
  if (mine) {
    await prisma.graphSubscription.upsert({
      where: { subscriptionId },
      create: {
        subscriptionId,
        resource: mine.resource,
        expirationDateTime: new Date(mine.expirationDateTime),
      },
      update: { expirationDateTime: new Date(mine.expirationDateTime) },
    });
  }

  logger.info({ subscriptionId }, 'subscription.ensured');
  return c.json({ subscriptionId });
});

/** Debug: list current Graph subscriptions. */
subscriptionsRouter.get('/', async (c) => {
  if (!requireInternalAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const subs = await listSubscriptions();
  return c.json({ subscriptions: subs });
});
