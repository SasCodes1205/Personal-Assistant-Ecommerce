import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { submitTranscript } from '../integrations/assemblyai.js';
import { extractMeeting } from '../agents/meeting-extractor.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

export const meetingsRouter = new Hono();

const ingestSchema = z.object({
  title: z.string(),
  audioUrl: z.string().url(),
  meetingDate: z.string().datetime(),
  businessUnit: z.enum(['NUTRITUNES', 'CEYLON_NUTRITIONALS', 'PERSONAL', 'UNKNOWN']).default('UNKNOWN'),
  attendees: z
    .array(z.object({ name: z.string(), email: z.string().optional(), role: z.string().optional() }))
    .optional(),
});

// Submit a meeting for processing
meetingsRouter.post('/ingest', async (c) => {
  const parsed = ingestSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const { title, audioUrl, meetingDate, businessUnit, attendees } = parsed.data;

  const meeting = await prisma.meeting.create({
    data: {
      title,
      audioUrl,
      meetingDate: new Date(meetingDate),
      businessUnit,
      attendees: attendees ?? null,
      status: 'UPLOADED',
    },
  });

  // Build webhook URL for AssemblyAI completion callback
  const webhookBase = new URL('/webhooks/assemblyai', `http://localhost:${env.PORT}`);
  // In production, replace with real public URL via env var
  const publicWebhookUrl = process.env.PUBLIC_API_URL
    ? `${process.env.PUBLIC_API_URL}/webhooks/assemblyai?meetingId=${meeting.id}`
    : `${webhookBase.toString()}?meetingId=${meeting.id}`;

  const transcript = await submitTranscript({
    audioUrl,
    webhookUrl: publicWebhookUrl,
    speakerLabels: true,
  });

  const updated = await prisma.meeting.update({
    where: { id: meeting.id },
    data: { assemblyAiId: transcript.id, status: 'TRANSCRIBING' },
  });

  logger.info({ meetingId: meeting.id, transcriptId: transcript.id }, 'meeting.submitted');
  return c.json(updated);
});

// List meetings
meetingsRouter.get('/', async (c) => {
  const meetings = await prisma.meeting.findMany({
    orderBy: { meetingDate: 'desc' },
    take: 50,
  });
  return c.json({ meetings });
});

// Get one meeting (with action items)
meetingsRouter.get('/:id', async (c) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: c.req.param('id') },
    include: { actionItems: true },
  });
  if (!meeting) return c.notFound();
  return c.json(meeting);
});

// Force re-extraction
meetingsRouter.post('/:id/extract', async (c) => {
  const result = await extractMeeting(c.req.param('id'));
  return c.json(result);
});

// Mark action item complete
meetingsRouter.post('/action-items/:id/complete', async (c) => {
  const updated = await prisma.actionItem.update({
    where: { id: c.req.param('id') },
    data: { completed: true, completedAt: new Date() },
  });
  return c.json(updated);
});
