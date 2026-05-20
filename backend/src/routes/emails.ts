import { Hono } from 'hono';
import { prisma } from '../db/prisma.js';
import { triageEmail } from '../agents/email-triage.js';
import { generateDraft } from '../agents/email-drafter.js';
import { sendDraft as gmailSendDraft } from '../integrations/gmail.js';
import { logger } from '../lib/logger.js';

export const emailsRouter = new Hono();

// List emails (with optional filters)
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

// List pending drafts (for the approval dashboard)
emailsRouter.get('/drafts/pending', async (c) => {
  const drafts = await prisma.draft.findMany({
    where: { status: 'PENDING_REVIEW' },
    orderBy: { createdAt: 'desc' },
    include: { email: true },
  });
  return c.json({ drafts });
});

// Get one email
emailsRouter.get('/:id', async (c) => {
  const email = await prisma.email.findUnique({
    where: { id: c.req.param('id') },
    include: { draft: true },
  });
  if (!email) return c.notFound();
  return c.json(email);
});

// Manually trigger triage on an email (debug + retry)
emailsRouter.post('/:id/triage', async (c) => {
  const result = await triageEmail(c.req.param('id'));
  return c.json(result);
});

// Manually trigger draft generation
emailsRouter.post('/:id/draft', async (c) => {
  const result = await generateDraft(c.req.param('id'));
  return c.json(result);
});

// Approve a draft — sends via Gmail
emailsRouter.post('/drafts/:id/approve', async (c) => {
  const draftId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const editedBody: string | undefined = body.editedBody;

  const draft = await prisma.draft.findUniqueOrThrow({
    where: { id: draftId },
    include: { email: true },
  });

  const flags = draft.complianceFlags as { gmailDraftId?: string } | null;
  if (!flags?.gmailDraftId) {
    return c.json({ error: 'No Gmail draft ID stored' }, 400);
  }

  // If CEO edited, we'd need to re-create the Gmail draft. For MVP, we send as-is
  // and store the edit for audit. Production: PATCH the Gmail draft before sending.
  await gmailSendDraft(flags.gmailDraftId);

  const updated = await prisma.draft.update({
    where: { id: draftId },
    data: {
      status: editedBody ? 'EDITED_AND_SENT' : 'APPROVED',
      editedBody,
      sentAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      eventType: 'draft_approved_and_sent',
      resultRefId: draftId,
      payload: { wasEdited: !!editedBody },
    },
  });

  logger.info({ draftId }, 'draft.sent');
  return c.json(updated);
});

// Reject a draft
emailsRouter.post('/drafts/:id/reject', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const updated = await prisma.draft.update({
    where: { id: c.req.param('id') },
    data: { status: 'REJECTED', rejectedReason: body.reason ?? 'No reason given' },
  });
  await prisma.auditLog.create({
    data: {
      eventType: 'draft_rejected',
      resultRefId: updated.id,
      payload: { reason: body.reason },
    },
  });
  return c.json(updated);
});
