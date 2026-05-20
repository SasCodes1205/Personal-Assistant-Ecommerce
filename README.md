# CEO Assistant — NUtritunes & Ceylon Nutritionals

Private, single-tenant AI assistant for the CEO. Replaces Fireflies, automates email triage, delivers daily briefings.

## TL;DR

**3 weeks to MVP. ~$45-80/month run rate.** Self-owned meeting pipeline (AssemblyAI + Claude) replaces Fireflies. Self-owned email triage and drafting via Gmail API + Claude. Next.js dashboard for human-in-the-loop approval. Slack for proactive briefings.

## Why this stack

| Decision | Choice | Why |
|---|---|---|
| **Transcription** | AssemblyAI Universal-2 | Claude API does *not* transcribe audio natively (verified Mar 2026). AssemblyAI gives speaker diarization out of the box — essential for extracting CEO commitments specifically. ~$0.37/hr. |
| **LLM** | Anthropic Claude (tiered) | Haiku 4.5 (triage), Sonnet 4.6 (drafts, extraction), Opus 4.7 (briefings, sensitive threads). Prompt caching on all system prompts and CEO context blocks. |
| **Backend** | Node.js + Hono (TypeScript) | Lightweight Express alternative. Same language as frontend. Boots in ms, deploys anywhere. |
| **DB** | Postgres (Supabase) | Relational fits the data model. Free tier covers v1. Built-in auth + storage. |
| **Queue** | Inngest | Serverless background jobs. Handles 10-minute transcription waits without spinning your own queue. Free tier covers v1. |
| **Frontend** | Next.js 15 + Tailwind + shadcn/ui | Fastest path to a clean internal dashboard. Deploy to Vercel. |
| **Hosting** | Railway (backend) + Vercel (frontend) | One-click deploys. No AWS Step Functions / Lambda complexity. |

## What this does NOT do (vs v1.1 proposal)

- **No AWS Step Functions / Lambda** — Inngest replaces orchestration with ~10 lines instead of ~500.
- **No DynamoDB session cache** — Postgres + Anthropic prompt caching handles it.
- **No vector DB** — Anthropic native memory tool + Postgres full-text search is enough for v1.
- **No Fireflies subscription** — owned pipeline.

## Architecture

```
                                    ┌─────────────────┐
                                    │   Next.js App   │  (Vercel)
                                    │  Dashboard +    │
                                    │  Approval UI    │
                                    └────────┬────────┘
                                             │  HTTPS
                                             ▼
   Gmail Push ──────────► ┌──────────────────────────────────┐ ◄──── Slack Events
   (Pub/Sub webhook)      │     Hono API + Inngest Workers   │
                          │         (Railway)                 │
   Meeting upload ───────►│                                   │
   (Supabase Storage URL) │   Routes: /emails /meetings       │
                          │           /briefings /webhooks    │
                          │                                   │
                          │   Agents:                         │
                          │   ├─ EmailTriage   (Haiku 4.5)    │
                          │   ├─ EmailDrafter  (Sonnet 4.6)   │
                          │   ├─ MeetingXtract (Sonnet 4.6)   │
                          │   └─ DailyBriefing (Opus 4.7)     │
                          └────────┬──────────────────┬───────┘
                                   │                  │
                          ┌────────▼─────┐   ┌────────▼────────┐
                          │  Postgres    │   │   External APIs │
                          │  (Supabase)  │   │   ├─ AssemblyAI │
                          │              │   │   ├─ Anthropic  │
                          │  drafts      │   │   ├─ Gmail      │
                          │  meetings    │   │   └─ Slack      │
                          │  briefings   │   └─────────────────┘
                          │  vips, etc.  │
                          └──────────────┘
```

## Setup

### Prerequisites
- Node.js 20+, pnpm 9+ (`npm install -g pnpm`)
- Docker (local Postgres for dev)
- Accounts: Anthropic, AssemblyAI, Google Cloud (Gmail API), Slack, Supabase

### Backend
```bash
cd backend
cp .env.example .env       # fill in API keys
docker compose up -d       # local Postgres (or skip — use Supabase URL)
pnpm install
pnpm prisma migrate dev    # create tables
pnpm dev                   # starts on :4000
```

### Frontend
```bash
cd frontend
cp .env.example .env       # set NEXT_PUBLIC_API_URL=http://localhost:4000
pnpm install
pnpm dev                   # starts on :3000
```

### Gmail Push subscription (one-time)
1. Create Google Cloud project, enable Gmail API + Pub/Sub
2. Create topic `projects/<id>/topics/gmail-push`
3. Grant `gmail-api-push@system.gserviceaccount.com` publish rights
4. POST `/gmail.users.watch` with the topic and your label IDs
5. Set Pub/Sub push subscription to `https://<your-api>.railway.app/webhooks/gmail`

### AssemblyAI webhook
When ingesting a meeting (`POST /meetings/ingest` with audio URL), backend hands off to AssemblyAI with `webhook_url` set to `<your-api>/webhooks/assemblyai`. On completion, the webhook fires the extraction agent.

## 3-week build plan

| Week | Deliverable | Gate |
|---|---|---|
| **1** | Meeting workflow end-to-end: upload → AssemblyAI → Claude extraction → dashboard view | 5 real meetings processed; extraction precision ≥85% on manual review |
| **2** | Email triage + draft generation; Gmail Push integration; draft approval UI | Classifier matches CEO judgment ≥90% on 50-email sample; draft approval rate ≥70% |
| **3** | Daily briefings (morning + EOD) via Slack; VIP detector; full audit log | CEO uses for 5 consecutive days, no critical incidents |

## Cost estimate

| Item | Monthly | Notes |
|---|---|---|
| Anthropic API | $25-45 | Heavy prompt caching; Haiku 4.5 for ~80% of email triage |
| AssemblyAI | $10-15 | ~30 hours of meetings at $0.37/hr |
| Railway (backend) | $5-10 | Hobby plan |
| Vercel (frontend) | $0 | Hobby plan |
| Supabase | $0 | Free tier |
| Inngest | $0 | Free tier (50k events/month) |
| **Total** | **$40-70** | Down from v1.1's $65-125 |

## Regulatory note

Drafts email replies and processes meeting notes for the CEO of two FDA/FTC-regulated businesses. **Every drafted reply is human-approved before sending.** The system never autonomously commits to claims, deliverables, or external statements. Audit log retains all drafts (approved + rejected) and every Claude API call.

## Security posture

- All API keys in env vars; never logged
- Database encrypted at rest (Supabase default)
- HTTPS only; HSTS enforced
- Single-user auth: magic link via Supabase Auth, restricted to CEO + project lead emails
- Audit log: every Claude call, every draft, every send, every approval
- No autonomous outbound: drafts created in Gmail's Drafts folder, never sent until CEO approves
