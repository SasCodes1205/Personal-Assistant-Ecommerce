import { Hono } from 'hono';
import { prisma } from '../db/prisma.js';
import { triageEmail } from '../agents/email-triage.js';
import { generateDraft } from '../agents/email-drafter.js';
import { updateDraftBody } from '../integrations/graph-mail.js';
import { logger } from '../lib/logger.js';

export const emailsRouter = new Hono();

emailsRouter.get('/', async (c) => {
  const category = c.req.query('category');
  const emails = await prisma.email.findMany({
    where: category ? { category: category as any } : undefined,
    orderBy: { receivedAt: 'desc' },
    take: 100,
    include: { draft: true },
  });
  return c.json({ emails });
});

// Pending drafts for the approval dashboard (now includes compliance fields)
emailsRouter.get('/drafts/pending', async (c) => {
  const drafts = await prisma.draft.findMany({
    where: { status: 'PENDING_REVIEW' },
    orderBy: { createdAt: 'desc' },
    include: { email: true },
  });
  return c.json({ drafts });
});

// Drafts blocked by the compliance reviewer (visible but not sendable)
emailsRouter.get('/drafts/blocked', async (c) => {
  const drafts = await prisma.draft.findMany({
    where: { status: 'AUTO_REJECTED' },
    orderBy: { createdAt: 'desc' },
    include: { email: true },
  });
  return c.json({ drafts });
});

emailsRouter.get('/:id', async (c) => {
  const email = await prisma.email.findUnique({
    where: { id: c.req.param('id') },
    include: { draft: true },
  });
  if (!email) return c.notFound();
  return c.json(email);
});

emailsRouter.post('/:id/triage', async (c) => {
  const result = await triageEmail(c.req.param('id'));
  return c.json(result);
});

emailsRouter.post('/:id/draft', async (c) => {
  const result = await generateDraft(c.req.param('id'));
  return c.json(result);
});

/**
 * Approve a draft.
 *
 * SECURITY MODEL (Master Plan: "read + draft only, no send without approval"):
 * The app holds Mail.ReadWrite, NOT Mail.Send. Approving does NOT auto-send.
 * If the CEO edited the text, we PATCH the Outlook draft so the edited version is
 * what's in his Drafts folder, then mark it APPROVED. The CEO sends from Outlook.
 *
 * RED-zone drafts are AUTO_REJECTED at creation and never reach this endpoint.
 */
emailsRouter.post('/drafts/:id/approve', async (c) => {
  const draftId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const editedBody: string | undefined = body.editedBody;

  const draft = await prisma.draft.findUniqueOrThrow({
    where: { id: draftId },
    include: { email: true },
  });

  if (draft.status === 'AUTO_REJECTED') {
    return c.json({ error: 'Draft was blocked by compliance review and cannot be approved' }, 409);
  }

  // If edited, update the Outlook draft body so Drafts reflects the final text.
  if (editedBody && draft.providerDraftId) {
    await updateDraftBody(draft.providerDraftId, editedBody);
  }

  const updated = await prisma.draft.update({
    where: { id: draftId },
    data: {
      status: 'APPROVED', // CEO sends from Outlook Drafts; no auto-send here
      editedBody,
    },
  });

  await prisma.auditLog.create({
    data: {
      eventType: 'draft_approved',
      resultRefId: draftId,
      payload: { wasEdited: !!editedBody, complianceZone: draft.complianceZone },
    },
  });

  logger.info({ draftId }, 'draft.approved');
  return c.json(updated);
});

emailsRouter.post('/drafts/:id/reject', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const updated = await prisma.draft.update({
    where: { id: c.req.param('id') },
    data: { status: 'REJECTED', rejectedReason: body.reason ?? 'No reason given' },
  });
  await prisma.auditLog.create({
    data: { eventType: 'draft_rejected', resultRefId: updated.id, payload: { reason: body.reason } },
  });
  return c.json(updated);
});
