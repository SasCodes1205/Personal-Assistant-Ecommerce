import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

/**
 * Microsoft Teams posting. Replaces integrations/slack.ts.
 *
 * MVP method (recommended): a Power Automate "Workflows" incoming webhook on the
 * target Teams channel ("Post to a channel when a webhook request is received").
 * Set TEAMS_WEBHOOK_URL to the generated HTTP POST URL. One-way (briefings/alerts)
 * is all Phase 1 needs.
 *
 * The webhook accepts an Adaptive Card payload. We send a simple TextBlock card
 * containing the briefing markdown. (Teams renders a safe subset of markdown in
 * Adaptive Card TextBlocks.)
 */

/** Post a briefing/alert to the Teams channel. Returns true on success. */
export async function postToTeams(markdown: string, title = 'NUTRITUNES Assistant'): Promise<boolean> {
  if (!env.TEAMS_WEBHOOK_URL) {
    logger.warn('TEAMS_WEBHOOK_URL not configured; skipping Teams post');
    return false;
  }

  const card = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: title },
            { type: 'TextBlock', text: markdown, wrap: true },
          ],
        },
      },
    ],
  };

  const res = await fetch(env.TEAMS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.error({ status: res.status, body: text.slice(0, 300) }, 'teams.post.error');
    return false;
  }
  logger.info('teams.post.ok');
  return true;
}

/** Convenience wrapper for the morning briefing. */
export async function postBriefing(markdown: string): Promise<boolean> {
  return postToTeams(markdown, 'Morning Briefing');
}
