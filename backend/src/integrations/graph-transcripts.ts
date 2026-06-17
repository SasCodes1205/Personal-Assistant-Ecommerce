import { graphFetch } from './graph-auth.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

/**
 * Teams meeting transcripts via Microsoft Graph.
 *
 * VERIFIED (Microsoft Learn, 2025):
 *  - List:    GET /users/{userId}/onlineMeetings/{meetingId}/transcripts
 *  - Content: GET /users/{userId}/onlineMeetings/{meetingId}/transcripts/{id}/content?$format=text/vtt
 *  - App-only permissions: OnlineMeetingTranscript.Read.All  AND  (for the
 *    /users/... path) a Teams APPLICATION ACCESS POLICY granted to the CEO user
 *    (New-CsApplicationAccessPolicy + Grant-CsApplicationAccessPolicy).
 *    The runbook listed only OnlineMeetingTranscript.Read.All — the access
 *    policy is the missing piece for app-only access. See IMPLEMENTATION_GUIDE.
 *  - The transcript API works for a meeting only if the meeting has NOT expired.
 *  - Transcripts appear a short time AFTER the meeting ends — allow a delay.
 *
 * This module is the "Teams path". The AssemblyAI path remains the fallback for
 * uploaded / Zoom / in-person recordings (see meeting-extractor.ts).
 */

const MAILBOX = env.MS_MAILBOX;

export type TranscriptSegment = { speaker: string; start: number; end: number; text: string };

/** List transcript metadata for an online meeting. */
export async function listTranscripts(onlineMeetingId: string): Promise<any[]> {
  const data = await graphFetch(
    `/users/${encodeURIComponent(MAILBOX)}/onlineMeetings/${onlineMeetingId}/transcripts`
  );
  return data.value ?? [];
}

/** Fetch transcript content as raw WEBVTT text. */
export async function getTranscriptVtt(
  onlineMeetingId: string,
  transcriptId: string
): Promise<string> {
  const res = await graphFetch(
    `/users/${encodeURIComponent(MAILBOX)}/onlineMeetings/${onlineMeetingId}/transcripts/${transcriptId}/content?$format=text/vtt`,
    { raw: true }
  );
  return res.text();
}

/**
 * Parse WEBVTT (Teams format) into speaker segments matching the existing
 * `speakerSegments` shape used by meeting-extractor.
 *
 * Teams VTT cue voice tag looks like:
 *   00:00:03.663 --> 00:00:07.903
 *   <v Nalin Siriwardhana>Hello everyone.</v>
 */
export function parseVtt(vtt: string): { segments: TranscriptSegment[]; text: string } {
  const segments: TranscriptSegment[] = [];
  const blocks = vtt.replace(/\r/g, '').split('\n\n');

  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const timeLine = lines.find((l) => l.includes('-->'));
    if (!timeLine) continue;

    const [startRaw, endRaw] = timeLine.split('-->').map((s) => s.trim().split(' ')[0]);
    const textLines = lines.slice(lines.indexOf(timeLine) + 1).join(' ');

    const voiceMatch = textLines.match(/<v\s+([^>]+)>(.*?)<\/v>/);
    const speaker = voiceMatch ? voiceMatch[1].trim() : 'Unknown';
    const text = (voiceMatch ? voiceMatch[2] : textLines).replace(/<[^>]+>/g, '').trim();
    if (!text) continue;

    segments.push({
      speaker,
      start: tsToSeconds(startRaw),
      end: tsToSeconds(endRaw),
      text,
    });
  }

  const text = segments.map((s) => `${s.speaker}: ${s.text}`).join('\n');
  logger.info({ segmentCount: segments.length }, 'teams.transcript.parsed');
  return { segments, text };
}

function tsToSeconds(ts: string): number {
  // formats: HH:MM:SS.mmm or MM:SS.mmm
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(ts) || 0;
}

/**
 * Convenience: pull the latest transcript for a meeting and return parsed
 * segments + a speaker-labeled transcript string ready for extraction.
 * Returns null if no transcript is available yet (caller can retry / fall back).
 */
export async function fetchLatestTeamsTranscript(
  onlineMeetingId: string
): Promise<{ transcriptId: string; segments: TranscriptSegment[]; text: string } | null> {
  const transcripts = await listTranscripts(onlineMeetingId);
  if (transcripts.length === 0) return null;
  // Most recent by createdDateTime
  transcripts.sort(
    (a, b) => new Date(b.createdDateTime).getTime() - new Date(a.createdDateTime).getTime()
  );
  const latest = transcripts[0];
  const vtt = await getTranscriptVtt(onlineMeetingId, latest.id);
  const { segments, text } = parseVtt(vtt);
  return { transcriptId: latest.id, segments, text };
}
