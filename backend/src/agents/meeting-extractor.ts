import type Anthropic from '@anthropic-ai/sdk';
import { runClaude, getToolUse } from '../integrations/anthropic.js';
import { env } from '../lib/env.js';
import { buildSystem } from '../prompts/ceo-context.js';
import { prisma } from '../db/prisma.js';
import { getTranscript } from '../integrations/assemblyai.js';

const EXTRACTOR_INSTRUCTIONS = `
You process meeting transcripts (with speaker labels) into structured notes.

The transcript will identify speakers as "Speaker A", "Speaker B", etc.
You will also receive an attendee list mapping speaker letters to real names
when available — use those real names in your output. If a speaker is
unidentified, refer to them as "Speaker X (unidentified)".

EXTRACT THE FOLLOWING:

1. SUMMARY: 3-5 sentences. What did this meeting accomplish? Lead with the
   most important outcome.

2. KEY_DECISIONS: Concrete decisions made in the meeting. For each:
   - decision: what was decided (one sentence, action-oriented)
   - owner: who is responsible
   - context: why this decision was made (one sentence)

3. CEO_COMMITMENTS: Things Nalin (the CEO) personally committed to do. These
   are the CRITICAL items — they go on his task list. For each:
   - commitment: what Nalin said he would do
   - deadline: when (parse phrases like "by end of week" into ISO date if possible,
     else state the phrase)
   - recipient: who he committed to (person or party)

4. ACTION_ITEMS: All other action items NOT owned by the CEO. For each:
   - text: the action
   - owner: who owns it (use real name from attendee list)
   - dueDate: ISO date if specified, null otherwise
   - isCeoTask: false for these (CEO items go in CEO_COMMITMENTS)

5. OPEN_QUESTIONS: Unresolved questions raised but not answered. For each:
   - question: the question
   - raisedBy: who raised it

6. TOPICS: 3-7 short topic tags (e.g. "Amazon ads", "Q4 planning", "supplier QC")

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
    required: [
      'summary',
      'keyDecisions',
      'ceoCommitments',
      'actionItems',
      'openQuestions',
      'topics',
    ],
  },
};

export async function extractMeeting(meetingId: string) {
  const meeting = await prisma.meeting.findUniqueOrThrow({
    where: { id: meetingId },
  });
  if (!meeting.assemblyAiId) throw new Error('Meeting has no AssemblyAI ID');

  // 1. Fetch transcript with utterances
  const transcript = await getTranscript(meeting.assemblyAiId);
  if (transcript.status !== 'completed') {
    throw new Error(`Transcript not ready: ${transcript.status}`);
  }

  // 2. Build speaker-labeled text
  const utterances = transcript.utterances ?? [];
  const speakerText = utterances
    .map((u) => `Speaker ${u.speaker}: ${u.text}`)
    .join('\n');

  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: 'EXTRACTING',
      transcriptText: transcript.text ?? '',
      speakerSegments: utterances as any,
      transcribedAt: new Date(),
    },
  });

  // 3. Build attendee mapping string
  const attendees = (meeting.attendees as any[]) ?? [];
  const attendeeStr = attendees.length
    ? `\nATTENDEES:\n${attendees.map((a) => `- ${a.name} (${a.role ?? 'attendee'})`).join('\n')}`
    : '';

  const userMessage = `
MEETING: ${meeting.title}
DATE: ${meeting.meetingDate.toISOString()}
BUSINESS UNIT: ${meeting.businessUnit}
${attendeeStr}

TRANSCRIPT (speaker-labeled):
${speakerText}

Extract structured notes now using the extract_meeting tool.
`.trim();

  // 4. Run extraction
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

  // 5. Persist
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

    // CEO commitments → ActionItem rows with isCeoTask = true
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
  // Try ISO first
  const iso = new Date(raw);
  if (!isNaN(iso.getTime())) return iso;
  // Could extend: parse "end of week", "EOD Friday", etc. via chrono-node later.
  return null;
}
