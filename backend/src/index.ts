import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serve as inngestServe } from 'inngest/hono';

import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { inngest, inngestFunctions } from './lib/inngest.js';

import { emailsRouter } from './routes/emails.js';
import { meetingsRouter } from './routes/meetings.js';
import { briefingsRouter } from './routes/briefings.js';
import { webhooksRouter } from './routes/webhooks.js';
import { vipsRouter } from './routes/vips.js';
import { subscriptionsRouter } from './routes/subscriptions.js';

const app = new Hono();

app.use('*', honoLogger());
app.use(
  '*',
  cors({
    origin: env.ALLOWED_ORIGIN,
    credentials: true,
  })
);

app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// REST API
app.route('/emails', emailsRouter);
app.route('/meetings', meetingsRouter);
app.route('/briefings', briefingsRouter);
app.route('/vips', vipsRouter);
app.route('/subscriptions', subscriptionsRouter);

// Webhooks (Microsoft Graph change-notifications + lifecycle, AssemblyAI completion)
app.route('/webhooks', webhooksRouter);

// Inngest endpoint for background workers (optional)
app.on(['GET', 'POST', 'PUT'], '/api/inngest', (c) => {
  return inngestServe({ client: inngest, functions: inngestFunctions })(c);
});

const port = env.PORT;
logger.info({ port }, 'CEO Assistant API starting');

serve({ fetch: app.fetch, port }, (info) => {
  logger.info(`Listening on http://localhost:${info.port}`);
});
