import type Anthropic from '@anthropic-ai/sdk';
import { runClaude, getToolUse } from '../integrations/anthropic.js';
import { env } from '../lib/env.js';
import { buildSystem } from '../prompts/ceo-context.js';
import { prisma } from '../db/prisma.js';
import { getTranscript } from '../integrations/assemblyai.js';
import { fetchLatestTeamsTranscript } from '../integrations/graph-transcripts.js';

const EXTRACTOR_INSTRUCTIONS = `
You process meeting transcripts (with speaker labels) into structured notes.

Speakers may be identified by real names (Teams transcripts) or as "Speaker A",
"Speaker B" (AssemblyAI). You will also receive an attendee list mapping speakers
to real names when available — use real names in your output. If a speaker is
unidentified, refer to them as "Speaker X (unidentified)".

EXTRACT THE FOLLOWING:

1. SUMMARY: 3-5 sentences. What did this meeting accomplish? Lead with the
   most important outcome.

2. KEY_DECISIONS: Concrete decisions made. For each: decision, owner, context.

3. CEO_COMMITMENTS: Things Nalin (the CEO) personally committed to. These are the
   CRITICAL items — they go on his task list. For each: commitment, deadline
   (parse "by end of week" into ISO date if possible, else the phrase), recipient.

4. ACTION_ITEMS: All other action items NOT owned by the CEO. For each: text,
   owner (real name from attendee list), dueDate (ISO date if specified, else null).

5. OPEN_QUESTIONS: Unresolved questions raised but not answered. For each:
   question, raisedBy.

6. TOPICS: 3-7 short topic tags.

REGULATORY FLAG:
If the meeting discusses making any disease claim, unsubstantiated health claim,
or label content that may violate FDA/FTC rules, surface it explicitly under
"openQuestions" as: "Regulatory review needed: <claim>".

Be precise. If a decision is ambiguous, capture it as an open question instead.
Never invent commitments or deadlines that weren't stated.
`.trim();

const extractTool: Anthropic.Messages.Tool = {
  name: 'extract_meeting',
  description: 'Return structured meeting notes.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      keyDecisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            decision: { type: 'string' },
            owner: { type: 'string' },
            context: { type: 'string' },
          },
          required: ['decision', 'owner', 'context'],
        },
      },
      ceoCommitments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            commitment: { type: 'string' },
            deadline: { type: 'string' },
            recipient: { type: 'string' },
          },
          required: ['commitment', 'deadline', 'recipient'],
        },
      },
      actionItems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            owner: { type: 'string' },
            dueDate: { type: ['string', 'null'] },
          },
          required: ['text', 'owner'],
        },
      },
      openQuestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            raisedBy: { type: 'string' },
          },
          required: ['question', 'raisedBy'],
        },
      },
      topics: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'keyDecisions', 'ceoCommitments', 'actionItems', 'openQuestions', 'topics'],
  },
};

/**
 * Resolve a speaker-labeled transcript from whichever source the meeting uses.
 * Returns { speakerText, segments } or throws if not yet available.
 */
async function loadTranscript(meeting: {
  id: string;
  transcriptSource: string;
  assemblyAiId: string | null;
  graphOnlineMeetingId: string | null;
}): Promise<{ speakerText: string; segments: any[]; graphTranscriptId?: string }> {
  if (meeting.transcriptSource === 'TEAMS') {
    if (!meeting.graphOnlineMeetingId) throw new Error('Teams meeting missing graphOnlineMeetingId');
    const t = await fetchLatestTeamsTranscript(meeting.graphOnlineMeetingId);
    if (!t) throw new Error('Teams transcript not available yet (retry later)');
    return { speakerText: t.text, segments: t.segments, graphTranscriptId: t.transcriptId };
  }

  // AssemblyAI fallback
  if (!meeting.assemblyAiId) throw new Error('Meeting has no AssemblyAI ID');
  const transcript = await getTranscript(meeting.assemblyAiId);
  if (transcript.status !== 'completed') throw new Error(`Transcript not ready: ${transcript.status}`);
  const utterances = transcript.utterances ?? [];
  const speakerText = utterances.map((u) => `Speaker ${u.speaker}: ${u.text}`).join('\n');
  return {
    speakerText: speakerText || (transcript.text ?? ''),
    segments: utterances as any[],
  };
}

export async function extractMeeting(meetingId: string) {
  const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });

  // 1. Load transcript from the correct source
  const { speakerText, segments, graphTranscriptId } = await loadTranscript(meeting as any);

  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: 'EXTRACTING',
      transcriptText: speakerText,
      speakerSegments: segments as any,
      transcribedAt: new Date(),
      ...(graphTranscriptId ? { graphTranscriptId } : {}),
    },
  });

  // 2. Build attendee mapping string
  const attendees = (meeting.attendees as any[]) ?? [];
  const attendeeStr = attendees.length
    ? `\nATTENDEES:\n${attendees.map((a) => `- ${a.name} (${a.role ?? 'attendee'})`).join('\n')}`
    : '';

  const userMessage = `
MEETING: ${meeting.title}
DATE: ${meeting.meetingDate.toISOString()}
BUSINESS UNIT: ${meeting.businessUnit}
TRANSCRIPT SOURCE: ${meeting.transcriptSource}
${attendeeStr}

TRANSCRIPT (speaker-labeled):
${speakerText}

Extract structured notes now using the extract_meeting tool.
`.trim();

  // 3. Run extraction
  const response = await runClaude({
    agent: 'MeetingExtractor',
    model: env.MODEL_EXTRACTION,
    system: buildSystem(EXTRACTOR_INSTRUCTIONS),
    messages: [{ role: 'user', content: userMessage }],
    tools: [extractTool],
    toolChoice: { type: 'tool', name: 'extract_meeting' },
    maxTokens: 4096,
    temperature: 0.2,
    resultRefId: meetingId,
  });

  const result = getToolUse<{
    summary: string;
    keyDecisions: any[];
    ceoCommitments: any[];
    actionItems: any[];
    openQuestions: any[];
    topics: string[];
  }>(response);

  if (!result) throw new Error('Extractor did not return tool_use');

  // 4. Persist
  await prisma.$transaction(async (tx) => {
    await tx.meeting.update({
      where: { id: meetingId },
      data: {
        summary: result.input.summary,
        keyDecisions: result.input.keyDecisions,
        ceoCommitments: result.input.ceoCommitments,
        openQuestions: result.input.openQuestions,
        topics: result.input.topics,
        status: 'COMPLETED',
        extractedAt: new Date(),
      },
    });

    for (const c of result.input.ceoCommitments) {
      await tx.actionItem.create({
        data: {
          meetingId,
          text: c.commitment,
          owner: 'Nalin Siriwardhana',
          dueDate: parseDeadline(c.deadline),
          isCeoTask: true,
        },
      });
    }
    for (const a of result.input.actionItems) {
      await tx.actionItem.create({
        data: {
          meetingId,
          text: a.text,
          owner: a.owner,
          dueDate: a.dueDate ? new Date(a.dueDate) : null,
          isCeoTask: false,
        },
      });
    }
  });

  return result.input;
}

function parseDeadline(raw: string): Date | null {
  if (!raw) return null;
  const iso = new Date(raw);
  if (!isNaN(iso.getTime())) return iso;
  return null;
}
