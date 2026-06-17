import { graphFetch } from './graph-auth.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

/**
 * Microsoft Graph change-notification subscriptions for real-time email.
 * Replaces Gmail Pub/Sub Push.
 *
 * VERIFIED (Microsoft Learn, 2025): mail message subscriptions have a MAXIMUM
 * lifetime of 4230 minutes (~2.94 days). We request ~4000 minutes for margin
 * and the renewal cron MUST run at least daily (see Stage 11). A weekly renewal
 * — like the old Gmail cron — is NOT sufficient and the subscription will lapse.
 */

const MAILBOX = env.MS_MAILBOX;
const RESOURCE = `/users/${MAILBOX}/mailFolders('Inbox')/messages`;
const MAX_MINUTES = 4000; // safe margin under the 4230-minute hard cap

function expiry(): string {
  return new Date(Date.now() + MAX_MINUTES * 60_000).toISOString();
}

/** Create the mail subscription. Returns the subscription id (persist it). */
export async function createMailSubscription(): Promise<{ id: string; expirationDateTime: string }> {
  const sub = await graphFetch('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      changeType: 'created',
      notificationUrl: `${env.PUBLIC_API_URL}/webhooks/graph`,
      lifecycleNotificationUrl: `${env.PUBLIC_API_URL}/webhooks/graph-lifecycle`,
      resource: RESOURCE,
      expirationDateTime: expiry(),
      clientState: env.GRAPH_SUBSCRIPTION_CLIENT_STATE,
    }),
  });
  logger.info({ id: sub.id, exp: sub.expirationDateTime }, 'graph.subscription.created');
  return { id: sub.id, expirationDateTime: sub.expirationDateTime };
}

/** Renew (extend) an existing subscription. Call from the daily cron. */
export async function renewMailSubscription(subscriptionId: string) {
  const sub = await graphFetch(`/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ expirationDateTime: expiry() }),
  });
  logger.info({ id: subscriptionId, exp: sub.expirationDateTime }, 'graph.subscription.renewed');
  return sub;
}

/** List current subscriptions (debug / idempotent re-create). */
export async function listSubscriptions(): Promise<any[]> {
  const data = await graphFetch('/subscriptions');
  return data.value ?? [];
}

/**
 * Ensure a single active mail subscription exists. If one already points at our
 * notificationUrl + resource, renew it; otherwise create one. Safe to call on
 * boot and from the renewal cron.
 */
export async function ensureMailSubscription(): Promise<string> {
  const subs = await listSubscriptions();
  const mine = subs.find(
    (s) =>
      s.notificationUrl === `${env.PUBLIC_API_URL}/webhooks/graph` &&
      s.resource?.includes("mailFolders('Inbox')/messages")
  );
  if (mine) {
    await renewMailSubscription(mine.id);
    return mine.id;
  }
  const created = await createMailSubscription();
  return created.id;
}
