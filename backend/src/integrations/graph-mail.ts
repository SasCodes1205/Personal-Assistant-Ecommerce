import { graphFetch } from './graph-auth.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

/**
 * Microsoft Graph mail integration. Replaces integrations/gmail.ts.
 *
 * Permissions required (Entra app registration, Application permissions,
 * admin-consented): Mail.Read, Mail.ReadWrite.
 *
 * NOTE on sending: we deliberately do NOT request Mail.Send. Drafts are created
 * in the CEO's Outlook Drafts folder and sent by the CEO from Outlook (or, if a
 * one-click dashboard send is later approved as a policy decision, add Mail.Send
 * and a send() function — see IMPLEMENTATION_GUIDE Stage 4 / Stage 8).
 */

const MAILBOX = env.MS_MAILBOX; // CEO email / UPN

/** Normalized email shape the rest of the app uses (provider-agnostic). */
export type NormalizedMessage = {
  providerMessageId: string;
  providerThreadId: string; // Graph "conversationId"
  from: string;
  fromName: string | null;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  receivedAt: Date;
};

function mapMessage(m: any): NormalizedMessage {
  const fromAddr = m.from?.emailAddress ?? m.sender?.emailAddress ?? {};
  const toAddr =
    (m.toRecipients ?? [])
      .map((r: any) => r.emailAddress?.address)
      .filter(Boolean)
      .join(', ') || '';
  const isHtml = m.body?.contentType === 'html';
  return {
    providerMessageId: m.id,
    providerThreadId: m.conversationId ?? m.id,
    from: fromAddr.address ?? '',
    fromName: fromAddr.name ?? null,
    to: toAddr,
    subject: m.subject ?? '(no subject)',
    bodyText: isHtml ? stripHtml(m.body?.content ?? '') : m.body?.content ?? '',
    bodyHtml: isHtml ? m.body?.content ?? null : null,
    receivedAt: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(),
  };
}

/** Minimal HTML → text. For richer extraction, swap in a library later. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|br|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Fetch a single message by Graph ID, normalized. */
export async function getMessage(messageId: string): Promise<NormalizedMessage> {
  const m = await graphFetch(
    `/users/${encodeURIComponent(MAILBOX)}/messages/${messageId}` +
      `?$select=id,conversationId,from,sender,toRecipients,subject,body,receivedDateTime`
  );
  return mapMessage(m);
}

/**
 * List recent Inbox messages (newest first). Used by the polling fallback and
 * initial backfill. `since` is an ISO timestamp; omit for the latest N.
 */
export async function listRecentMessages(opts: {
  since?: string;
  top?: number;
}): Promise<NormalizedMessage[]> {
  const top = opts.top ?? 25;
  const filter = opts.since
    ? `&$filter=receivedDateTime gt ${opts.since}`
    : '';
  const data = await graphFetch(
    `/users/${encodeURIComponent(MAILBOX)}/mailFolders('Inbox')/messages` +
      `?$orderby=receivedDateTime desc&$top=${top}` +
      `&$select=id,conversationId,from,sender,toRecipients,subject,body,receivedDateTime${filter}`
  );
  return (data.value ?? []).map(mapMessage);
}

/**
 * Create a REPLY DRAFT in Outlook Drafts. Never sends.
 * Uses Graph createReply to preserve threading, then PATCHes the body.
 * Returns the Outlook draft message id (store as Draft.providerDraftId).
 */
export async function createDraft(opts: {
  replyToMessageId: string;
  body: string;
}): Promise<{ providerDraftId: string }> {
  // 1. createReply returns a draft message in the same conversation.
  const draft = await graphFetch(
    `/users/${encodeURIComponent(MAILBOX)}/messages/${opts.replyToMessageId}/createReply`,
    { method: 'POST', body: JSON.stringify({}) }
  );

  // 2. Set the body to our generated text (plain text).
  await graphFetch(`/users/${encodeURIComponent(MAILBOX)}/messages/${draft.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      body: { contentType: 'text', content: opts.body },
    }),
  });

  logger.info({ draftId: draft.id }, 'graph.draft.created');
  return { providerDraftId: draft.id };
}

/** Update an existing Outlook draft's body (used when the CEO edits before approval). */
export async function updateDraftBody(providerDraftId: string, body: string) {
  await graphFetch(`/users/${encodeURIComponent(MAILBOX)}/messages/${providerDraftId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: { contentType: 'text', content: body } }),
  });
  logger.info({ providerDraftId }, 'graph.draft.updated');
}
