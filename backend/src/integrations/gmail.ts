import { google, gmail_v1 } from 'googleapis';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

function getOAuthClient() {
  const oauth2 = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

export function getGmail(): gmail_v1.Gmail {
  return google.gmail({ version: 'v1', auth: getOAuthClient() });
}

/** Fetch full message by ID. */
export async function getMessage(messageId: string) {
  const gmail = getGmail();
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return res.data;
}

/** Decode a Gmail-format body payload to plain text + html. */
export function extractBodies(message: gmail_v1.Schema$Message): {
  text: string;
  html: string;
} {
  let text = '';
  let html = '';

  const walk = (part: gmail_v1.Schema$MessagePart | undefined) => {
    if (!part) return;
    const mime = part.mimeType ?? '';
    const data = part.body?.data;
    if (data) {
      const decoded = Buffer.from(data, 'base64url').toString('utf-8');
      if (mime === 'text/plain' && !text) text = decoded;
      else if (mime === 'text/html' && !html) html = decoded;
    }
    if (part.parts) for (const p of part.parts) walk(p);
  };
  walk(message.payload ?? undefined);
  return { text, html };
}

export function getHeader(
  message: gmail_v1.Schema$Message,
  name: string
): string | undefined {
  const headers = message.payload?.headers ?? [];
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

/**
 * Create a Gmail DRAFT (not a send). The CEO approves in the dashboard,
 * which then triggers the actual send via gmail.users.drafts.send.
 */
export async function createDraft(opts: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}) {
  const gmail = getGmail();
  const lines = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : '',
    opts.references ? `References: ${opts.references}` : '',
    'Content-Type: text/plain; charset=utf-8',
    '',
    opts.body,
  ]
    .filter(Boolean)
    .join('\r\n');

  const raw = Buffer.from(lines).toString('base64url');
  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw, threadId: opts.threadId } },
  });
  logger.info({ draftId: res.data.id }, 'gmail.draft.created');
  return res.data;
}

/** Send an existing draft. ONLY called after explicit CEO approval. */
export async function sendDraft(draftId: string) {
  const gmail = getGmail();
  const res = await gmail.users.drafts.send({
    userId: 'me',
    requestBody: { id: draftId },
  });
  logger.info({ draftId, messageId: res.data.id }, 'gmail.draft.sent');
  return res.data;
}

/** Fetch unread messages in a label, after a given historyId. */
export async function listMessagesAfter(historyId: string) {
  const gmail = getGmail();
  const res = await gmail.users.history.list({
    userId: 'me',
    startHistoryId: historyId,
    historyTypes: ['messageAdded'],
  });
  return res.data.history ?? [];
}
