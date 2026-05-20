import { Hono } from 'hono';
import { prisma } from '../db/prisma.js';
import { generateMorningBriefing } from '../agents/daily-briefing.js';

export const briefingsRouter = new Hono();

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

// Manual trigger — for testing and ad-hoc generation
briefingsRouter.post('/morning', async (c) => {
  const briefing = await generateMorningBriefing();
  return c.json(briefing);
});

// TODO: /end-of-day, /pre-meeting/:meetingId
