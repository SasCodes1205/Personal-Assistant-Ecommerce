import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';

export const vipsRouter = new Hono();

const vipSchema = z.object({
  email: z.string().email(),
  name: z.string(),
  relationship: z.string(),
  businessUnit: z.enum(['NUTRITUNES', 'CEYLON_NUTRITIONALS', 'PERSONAL', 'UNKNOWN']),
  notes: z.string().optional(),
});

vipsRouter.get('/', async (c) => {
  const vips = await prisma.vipContact.findMany({ orderBy: { name: 'asc' } });
  return c.json({ vips });
});

vipsRouter.post('/', async (c) => {
  const parsed = vipSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const created = await prisma.vipContact.create({ data: parsed.data });
  return c.json(created);
});

vipsRouter.delete('/:id', async (c) => {
  await prisma.vipContact.delete({ where: { id: c.req.param('id') } });
  return c.json({ ok: true });
});
