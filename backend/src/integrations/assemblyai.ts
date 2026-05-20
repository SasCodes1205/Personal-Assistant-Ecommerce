import { AssemblyAI } from 'assemblyai';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

export const assemblyai = new AssemblyAI({ apiKey: env.ASSEMBLYAI_API_KEY });

export type SubmitTranscriptParams = {
  audioUrl: string;
  webhookUrl: string;
  speakerLabels?: boolean;
};

/**
 * Submit an audio URL for asynchronous transcription.
 * Returns AssemblyAI transcript ID. Completion arrives at webhookUrl.
 *
 * Important: AssemblyAI's `webhook_auth_header_name` + `webhook_auth_header_value`
 * provides a shared-secret check on the webhook so we don't process spoofed callbacks.
 */
export async function submitTranscript(params: SubmitTranscriptParams) {
  const { audioUrl, webhookUrl, speakerLabels = true } = params;

  const transcript = await assemblyai.transcripts.submit({
    audio_url: audioUrl,
    speaker_labels: speakerLabels,
    webhook_url: webhookUrl,
    webhook_auth_header_name: env.ASSEMBLYAI_WEBHOOK_AUTH_HEADER,
    webhook_auth_header_value: env.ASSEMBLYAI_WEBHOOK_SECRET,
  });

  logger.info({ transcriptId: transcript.id, audioUrl }, 'assemblyai.submitted');
  return transcript;
}

/** Fetch a completed transcript with utterances (speaker-segmented). */
export async function getTranscript(transcriptId: string) {
  return assemblyai.transcripts.get(transcriptId);
}

/** Verify the shared-secret header on incoming AssemblyAI webhook. */
export function verifyWebhookAuth(headerValue: string | undefined): boolean {
  if (!headerValue) return false;
  return headerValue === env.ASSEMBLYAI_WEBHOOK_SECRET;
}
