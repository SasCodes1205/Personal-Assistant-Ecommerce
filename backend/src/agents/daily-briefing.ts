import { runClaude, getText } from '../integrations/anthropic.js';
import { env } from '../lib/env.js';
import { buildSystem } from '../prompts/ceo-context.js';
import { prisma } from '../db/prisma.js';
import { postBriefing, markdownToBlocks } from '../integrations/slack.js';

const MORNING_INSTRUCTIONS = `
You produce the CEO's MORNING BRIEFING. It is delivered via Slack at 6:00 AM NJ time,
which is 3:30 PM Sri Lanka time (team's end-of-workday).

STRUCTURE (use exactly this markdown — concise, scannable):

# Morning Briefing — <date>

## 🎯 Top 3 Priorities Today
Three highest-leverage items. One line each. Lead with the most important.

## 📬 Email Queue
- Pending drafts: <N> (link: dashboard)
- VIP threads waiting: <list with one-line context each>
- Anything URGENT not yet drafted: <list>

## 📋 Open CEO Commitments
List Nalin's outstanding commitments from recent meetings. Show the recipient and
the original deadline. Flag anything overdue with ⚠️.

## 🇱🇰 Sri Lanka Team — End of Day Summary
What did the team complete today (their EOD)? What's blocked? What needs CEO
input before they start tomorrow (NJ evening = SL morning)?
If no team updates are available, state that.

## 📅 Today's Meetings
List today's meetings (NJ time + SL time). Note any with no agenda or unprepared
materials. Empty section = "No external meetings scheduled."

## ⚠️ Flags
Regulatory issues, overdue items, items requiring CEO judgment.
Empty section = "None."

RULES:
- Lead with what's most important. CEO will spend 60 seconds on this.
- No filler, no encouragement, no greetings.
- If a section has nothing, say so in one line — don't omit the header.
- Times always shown in NJ time first, SL time in parens: "9:00 AM ET (6:30 PM SLT)".
- Currency is USD.
- Never invent items. If a section's source data is empty, state "None."
`.trim();

export async function generateMorningBriefing() {
  // Gather raw data from the past 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [pendingDrafts, vipEmails, urgentEmails, openCommitments, recentMeetings] =
    await Promise.all([
      prisma.draft.count({ where: { status: 'PENDING_REVIEW' } }),
      prisma.email.findMany({
        where: { isVip: true, receivedAt: { gte: since } },
        orderBy: { receivedAt: 'desc' },
        take: 10,
      }),
      prisma.email.findMany({
        where: { category: 'URGENT', receivedAt: { gte: since } },
        orderBy: { receivedAt: 'desc' },
        take: 10,
      }),
      prisma.actionItem.findMany({
        where: { isCeoTask: true, completed: false },
        orderBy: { dueDate: 'asc' },
        take: 20,
        include: { meeting: { select: { title: true, meetingDate: true } } },
      }),
      prisma.meeting.findMany({
        where: { extractedAt: { gte: since } },
        orderBy: { meetingDate: 'desc' },
        take: 5,
      }),
    ]);

  const userMessage = `
DATE: ${new Date().toISOString().slice(0, 10)}

DATA FOR BRIEFING:

Pending email drafts (count): ${pendingDrafts}

VIP emails received in last 24h:
${vipEmails.length === 0 ? 'None.' : vipEmails.map((e) => `- ${e.from} | "${e.subject}" | ${e.triageReasoning ?? ''}`).join('\n')}

URGENT emails received in last 24h:
${urgentEmails.length === 0 ? 'None.' : urgentEmails.map((e) => `- ${e.from} | "${e.subject}"`).join('\n')}

Open CEO commitments:
${openCommitments.length === 0 ? 'None.' : openCommitments
  .map(
    (c) =>
      `- "${c.text}" | due: ${c.dueDate?.toISOString() ?? 'no deadline'} | from meeting: "${c.meeting.title}" (${c.meeting.meetingDate.toISOString().slice(0, 10)})`
  )
  .join('\n')}

Recently extracted meetings (for SL team EOD context):
${recentMeetings.length === 0 ? 'None.' : recentMeetings
  .map((m) => `- "${m.title}" (${m.meetingDate.toISOString().slice(0, 10)}) — ${m.summary?.slice(0, 200) ?? ''}`)
  .join('\n')}

Today's meetings: (calendar integration pending — assume none scheduled)

Now generate the briefing.
`.trim();

  const response = await runClaude({
    agent: 'DailyBriefing',
    model: env.MODEL_BRIEFING,
    system: buildSystem(MORNING_INSTRUCTIONS),
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 2048,
    temperature: 0.4,
  });

  const markdown = getText(response).trim();

  const briefing = await prisma.briefing.create({
    data: {
      type: 'MORNING_DIGEST',
      generatedFor: new Date(),
      bodyMarkdown: markdown,
      modelUsed: env.MODEL_BRIEFING,
    },
  });

  // Push to Slack
  const ts = await postBriefing(`Morning Briefing`, markdownToBlocks(markdown));
  if (ts) {
    await prisma.briefing.update({ where: { id: briefing.id }, data: { slackTs: ts } });
  }

  return briefing;
}
