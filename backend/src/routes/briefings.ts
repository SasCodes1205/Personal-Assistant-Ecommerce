import { Hono } from 'hono';
import { prisma } from '../db/prisma.js';
import { generateMorningBriefing } from '../agents/daily-briefing.js';
import { env } from '../lib/env.js';

export const briefingsRouter = new Hono();

/** Internal-secret guard for trigger endpoints hit by cron. */
function requireInternalAuth(authHeader?: string): boolean {
  return authHeader === `Bearer ${env.INTERNAL_API_SECRET}`;
}

briefingsRouter.get('/', async (c) => {
  const briefings = await prisma.briefing.findMany({
    orderBy: { generatedAt: 'desc' },
    take: 30,
  });
  return c.json({ briefings });
});

briefingsRouter.get('/:id', async (c) => {
  const briefing = await prisma.briefing.findUnique({ where: { id: c.req.param('id') } });
  if (!briefing) return c.notFound();
  return c.json(briefing);
});

/**
 * Trigger the morning briefing. Now PROTECTED (was open).
 * Called by the scheduled cron with Authorization: Bearer <INTERNAL_API_SECRET>.
 */
briefingsRouter.post('/morning', async (c) => {
  if (!requireInternalAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const briefing = await generateMorningBriefing();
  return c.json(briefing);
});

// TODO: /end-of-day, /pre-meeting/:meetingId (post-MVP)
