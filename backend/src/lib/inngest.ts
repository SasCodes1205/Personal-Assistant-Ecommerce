import { Inngest, EventSchemas } from 'inngest';
import { env } from './env.js';

// Event types for type-safe Inngest functions.
// NOTE: Inngest is OPTIONAL for the MVP — the email/meeting flows run inline.
// Its value drops further now that Teams transcripts return quickly via Graph.
// Keep this only if you want durable retries/fan-out later.
type Events = {
  'meeting/pending': { data: { meetingId: string; source: 'TEAMS' | 'ASSEMBLYAI' | 'UPLOAD' } };
  'meeting/transcribed': { data: { meetingId: string } };
  'email/received': { data: { providerMessageId: string } };
  'email/triaged': { data: { emailId: string } };
  'briefing/scheduled': { data: { type: 'MORNING_DIGEST' | 'END_OF_DAY' } };
};

export const inngest = new Inngest({
  id: 'ceo-assistant',
  eventKey: env.INNGEST_EVENT_KEY,
  schemas: new EventSchemas().fromRecord<Events>(),
});

export const inngestFunctions: any[] = [];
