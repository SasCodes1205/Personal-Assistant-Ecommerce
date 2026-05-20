import { WebClient } from '@slack/web-api';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

export const slack = env.SLACK_BOT_TOKEN ? new WebClient(env.SLACK_BOT_TOKEN) : null;

/** Send a DM to the CEO. Returns ts (message timestamp) for threading. */
export async function dmCeo(text: string, blocks?: any[]) {
  if (!slack || !env.SLACK_CEO_USER_ID) {
    logger.warn('Slack not configured; skipping DM');
    return null;
  }
  const res = await slack.chat.postMessage({
    channel: env.SLACK_CEO_USER_ID,
    text,
    blocks,
  });
  return res.ts ?? null;
}

/** Post to the dedicated briefings channel. */
export async function postBriefing(text: string, blocks?: any[]) {
  if (!slack || !env.SLACK_BRIEFINGS_CHANNEL) {
    logger.warn('Slack briefings channel not configured');
    return null;
  }
  const res = await slack.chat.postMessage({
    channel: env.SLACK_BRIEFINGS_CHANNEL,
    text,
    blocks,
  });
  return res.ts ?? null;
}

/** Helper: convert markdown briefing to Slack mrkdwn blocks. */
export function markdownToBlocks(markdown: string): any[] {
  // Split on h1/h2 to make sections
  const sections = markdown.split(/\n(?=#{1,2} )/g);
  return sections.map((section) => ({
    type: 'section',
    text: {
      type: 'mrkdwn',
      // Slack mrkdwn: convert # headers to bold, ## to bold
      text: section
        .replace(/^#{1,2} (.+)$/gm, '*$1*')
        .replace(/\*\*(.+?)\*\*/g, '*$1*'),
    },
  }));
}
