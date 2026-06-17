import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().min(1),
  MODEL_TRIAGE: z.string().default('claude-haiku-4-5-20251001'),
  MODEL_DRAFT: z.string().default('claude-sonnet-4-6'),
  MODEL_BRIEFING: z.string().default('claude-opus-4-8'),     // updated from stale 4-7
  MODEL_EXTRACTION: z.string().default('claude-sonnet-4-6'),
  MODEL_COMPLIANCE: z.string().default('claude-opus-4-8'),   // NEW — high-tier for regulatory stakes

  ASSEMBLYAI_API_KEY: z.string().min(1),
  ASSEMBLYAI_WEBHOOK_AUTH_HEADER: z.string().default('X-Webhook-Secret'),
  ASSEMBLYAI_WEBHOOK_SECRET: z.string().min(1),

  // ----- Microsoft 365 (Entra app registration) — replaces Google/Gmail -----
  AZURE_TENANT_ID: z.string().min(1),
  AZURE_CLIENT_ID: z.string().min(1),
  AZURE_CLIENT_SECRET: z.string().min(1),
  MS_MAILBOX: z.string().email(),                 // CEO email / UPN the app reads + drafts in
  GRAPH_SUBSCRIPTION_CLIENT_STATE: z.string().min(8), // random secret to validate notifications

  // ----- Microsoft Teams (briefings/alerts) — replaces Slack -----
  TEAMS_WEBHOOK_URL: z.string().url().optional(), // Power Automate incoming webhook

  // Public URL is required for Graph change-notification webhooks
  PUBLIC_API_URL: z.string().url(),

  // Auth secret protecting internal trigger endpoints (briefings, subscription renew)
  INTERNAL_API_SECRET: z.string().min(8),

  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),

  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ALLOWED_ORIGIN: z.string().default('http://localhost:3000'),

  CEO_NAME: z.string().default('Nalin Siriwardhana'),
  CEO_TIMEZONE: z.string().default('America/New_York'),
  TEAM_TIMEZONE: z.string().default('Asia/Colombo'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
