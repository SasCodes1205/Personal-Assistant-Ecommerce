import { Inngest, EventSchemas } from 'inngest';
import { env } from './env.js';

// Event types for type-safe Inngest functions
type Events = {
  'meeting/uploaded': { data: { meetingId: string; audioUrl: string } };
  'meeting/transcribed': { data: { meetingId: string; assemblyAiId: string } };
  'email/received': { data: { gmailMessageId: string } };
  'email/triaged': { data: { emailId: string } };
  'briefing/scheduled': { data: { type: 'MORNING_DIGEST' | 'END_OF_DAY' } };
};

export const inngest = new Inngest({
  id: 'ceo-assistant',
  eventKey: env.INNGEST_EVENT_KEY,
  schemas: new EventSchemas().fromRecord<Events>(),
});

// Function registry — imported and registered with serve()
// Each function is a separate file under src/agents/workers/
// Stub array; populate as you build each workflow.
export const inngestFunctions: any[] = [
  // import { processMeetingFn } from '../agents/workers/process-meeting.js'
  // import { triageEmailFn } from '../agents/workers/triage-email.js'
  // import { generateDraftFn } from '../agents/workers/generate-draft.js'
  // import { sendBriefingFn } from '../agents/workers/send-briefing.js'
];
