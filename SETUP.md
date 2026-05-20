# SETUP — Step by Step

Total time: **~6-8 hours of work** spread across CEO and developer. Most can be done in parallel.

## Roles in this guide

- **[CEO]** = Nalin. Creates accounts, holds payment methods, clicks through OAuth consent screens.
- **[DEV]** = Sasindi or whoever runs the build. Touches code and deploys.
- **[BOTH]** = One needs the other (e.g., CEO must be logged in while DEV walks them through OAuth).

## Stage map

| # | Stage | Who | Time | Blocking? |
|---|---|---|---|---|
| 1 | Dev tooling | DEV | 15 min | No |
| 2 | API accounts + keys | CEO | 60 min | Blocks everything |
| 3 | Local environment up | DEV | 30 min | — |
| 4 | Claude smoke test | DEV | 5 min | — |
| 5 | Gmail OAuth refresh token | BOTH | 45 min | Blocks email workflow |
| 6 | Slack app + first briefing | BOTH | 30 min | Blocks briefings |
| 7 | AssemblyAI + first meeting E2E | DEV | 45 min | Blocks meeting workflow |
| 8 | Production deploy | DEV | 60 min | Blocks Stage 9-10 |
| 9 | Gmail Push subscription | DEV | 60 min | Email automation |
| 10 | Scheduled briefings (cron) | DEV | 15 min | — |

---

## STAGE 1 — Dev tooling [DEV]

```bash
# Check Node 20+
node --version          # need v20.x or higher

# Install pnpm globally
npm install -g pnpm

# Verify Docker is running
docker --version
docker ps               # should not error
```

If missing: install from [nodejs.org](https://nodejs.org), [docker.com](https://docker.com).

---

## STAGE 2 — API accounts and keys [CEO]

Open a password manager (1Password recommended) and create a vault item called **"CEO Assistant — API Keys"**. Save every key as you go.

### 2.1 Anthropic
1. Sign up at [console.anthropic.com](https://console.anthropic.com) with NUtritunes email.
2. Settings → **API keys** → Create key, name it `ceo-assistant-prod`.
3. Billing → add payment method.
4. **Set a budget alert at $100/month** (Settings → Limits).
5. Save key as `ANTHROPIC_API_KEY`.

### 2.2 AssemblyAI
1. Sign up at [assemblyai.com](https://www.assemblyai.com).
2. Dashboard → copy the API key (top right).
3. Add payment method (pay-as-you-go, ~$0.37/hr of audio).
4. Save as `ASSEMBLYAI_API_KEY`.
5. Generate a random 32-char string (e.g. `openssl rand -hex 16`) and save as `ASSEMBLYAI_WEBHOOK_SECRET` — used to authenticate AssemblyAI's callbacks to our backend.

### 2.3 Supabase (Postgres + storage)
1. [supabase.com](https://supabase.com) → New project.
2. Region: **East US (N. Virginia)** — closest to NJ.
3. Database password: generate strong, save in 1Password.
4. Wait ~2 min for project to provision.
5. Settings → Database → **Connection string** → URI mode. Save as `DATABASE_URL`.
6. Settings → API → save **Project URL** as `SUPABASE_URL`, **service_role key** as `SUPABASE_SERVICE_KEY`. (Service role, **not** anon. Backend bypasses RLS.)
7. Storage → New bucket → name `meetings`, **public access** (we'll lock down with signed URLs later).

### 2.4 Google Cloud (for Gmail)
1. [console.cloud.google.com](https://console.cloud.google.com) → New project, name `ceo-assistant`.
2. APIs & Services → **Library** → enable: **Gmail API**, **Cloud Pub/Sub API**.
3. APIs & Services → **OAuth consent screen**:
   - User type: **External** (or Internal if you're on Google Workspace org)
   - App name: "CEO Assistant"
   - User support email: CEO email
   - Scopes → Add: `https://www.googleapis.com/auth/gmail.modify`
   - Test users → add CEO email (so the unverified app can be used)
4. APIs & Services → **Credentials** → Create credentials → OAuth client ID:
   - Application type: **Web application**
   - Name: "CEO Assistant Web"
   - Authorized redirect URIs: `https://developers.google.com/oauthplayground` (we'll use this in Stage 5)
5. Save **Client ID** as `GOOGLE_CLIENT_ID` and **Client Secret** as `GOOGLE_CLIENT_SECRET`.
6. Note your **Project ID** (top of console) — needed for Pub/Sub topic name later.

### 2.5 Slack
1. [api.slack.com/apps](https://api.slack.com/apps) → Create New App → **From scratch**.
2. App name: "CEO Assistant". Workspace: NUtritunes workspace.
3. **OAuth & Permissions** → Bot Token Scopes → add:
   - `chat:write`
   - `chat:write.public`
   - `im:write`
   - `users:read`
4. **Install to workspace** → authorize.
5. Copy **Bot User OAuth Token** (starts `xoxb-`) → save as `SLACK_BOT_TOKEN`.
6. Basic Information → copy **Signing Secret** → save as `SLACK_SIGNING_SECRET`.
7. In Slack:
   - Create channel `#ceo-briefings` → invite the bot (`/invite @CEO Assistant`).
   - Right-click your name → Copy member ID → save as `SLACK_CEO_USER_ID`.
   - Right-click channel → Copy channel ID → save as `SLACK_BRIEFINGS_CHANNEL`.

### 2.6 Inngest (defer to Stage 8 if you want)
Skip for now; the system works without it for v0. We'll add when scaling.

---

## STAGE 3 — Local environment [DEV]

```bash
# 1. Unzip and enter project
unzip ceo-assistant.zip
cd ceo-assistant

# 2. Backend setup
cd backend
cp .env.example .env
# Edit .env — paste in every value from Stage 2

# 3. Start local Postgres (skip if using Supabase URL directly)
docker compose up -d

# 4. Install + migrate
pnpm install
pnpm prisma generate
pnpm prisma migrate dev --name init

# 5. Run dev server
pnpm dev
# → "Listening on http://localhost:4000"
```

**Verify:**
```bash
curl http://localhost:4000/health
# → {"ok":true,"ts":"2026-05-15T..."}
```

**Frontend (new terminal):**
```bash
cd ceo-assistant/frontend
cp .env.example .env       # NEXT_PUBLIC_API_URL=http://localhost:4000 (default)
pnpm install
pnpm dev
# → http://localhost:3000
```

Open the browser. You should see the dashboard with 0 drafts / 0 meetings / 0 briefings.

---

## STAGE 4 — Claude smoke test [DEV]

In the backend folder:
```bash
# Quick one-liner test
node --experimental-vm-modules -e "
import('@anthropic-ai/sdk').then(async ({ default: Anthropic }) => {
  const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const r = await c.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }]
  });
  console.log(r.content[0].text);
});
" 2>/dev/null
# → OK
```

If it returns "OK", Anthropic is wired correctly. If 401 → wrong API key. If 429 → no payment method on Anthropic account.

---

## STAGE 5 — Gmail OAuth refresh token [BOTH]

**This is the trickiest step.** Gmail needs a *refresh token* (long-lived) because the backend acts on the CEO's mailbox 24/7. You can't get one from the standard console — you have to do an OAuth dance.

**Easiest path: OAuth Playground.**

1. **[DEV]** Go to [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground).
2. **[DEV]** Click the **gear icon** (top right) → check **"Use your own OAuth credentials"** → paste the Client ID and Client Secret from Stage 2.4.
3. **[DEV]** Step 1 (left panel) → scroll to **Gmail API v1** → check:
   - `https://www.googleapis.com/auth/gmail.modify`
4. **[DEV]** Click **Authorize APIs**.
5. **[CEO]** Browser redirects to Google sign-in → **sign in with your NUtritunes Google account** (the same one you'll use the assistant for).
6. **[CEO]** "Google hasn't verified this app" warning → click **Advanced** → **Go to CEO Assistant (unsafe)**. (This is fine — your own app, restricted to your test-user list.)
7. **[CEO]** Grant the requested permissions.
8. **[BOTH]** You return to the Playground at Step 2.
9. **[DEV]** Click **"Exchange authorization code for tokens"**.
10. **[DEV]** You'll see an **Access token** and a **Refresh token**. Copy the **refresh token** (starts with `1//`).
11. **[DEV]** Paste into `backend/.env` as `GOOGLE_REFRESH_TOKEN`. Also set `GMAIL_USER_EMAIL=` to the CEO's address.
12. **[DEV]** Restart backend (`Ctrl+C`, `pnpm dev`).

**Verify Gmail access:**
1. In Gmail web UI, open any email → URL ends with something like `/0/#inbox/FMfcgz...`. That suffix is *close* to the message ID but not exact.
2. Easier: use the API directly:
```bash
# Get a recent message ID via the API (uses your refresh token)
curl http://localhost:4000/health  # confirm backend up first

# In a Node shell:
node -e "
const { google } = require('googleapis');
const o = new google.auth.OAuth2('$GOOGLE_CLIENT_ID', '$GOOGLE_CLIENT_SECRET');
o.setCredentials({ refresh_token: '$GOOGLE_REFRESH_TOKEN' });
google.gmail({version: 'v1', auth: o}).users.messages.list({userId: 'me', maxResults: 5})
  .then(r => console.log(r.data.messages));
"
```
You should see 5 message IDs.

3. Ingest one:
```bash
curl -X POST http://localhost:4000/webhooks/gmail/ingest \
  -H "Content-Type: application/json" \
  -d '{"messageId":"<paste-message-id>"}'
```

You should get back a triage result. Visit `http://localhost:3000/drafts` — if Claude decided the email warranted a reply, you'll see a draft to approve.

---

## STAGE 6 — Slack first briefing [BOTH]

**[DEV]** Generate a test briefing:
```bash
curl -X POST http://localhost:4000/briefings/morning
```

**[CEO]** Check `#ceo-briefings` in Slack. You should see the briefing within a few seconds.

If nothing arrives:
- 404 → `SLACK_BRIEFINGS_CHANNEL` wrong (check it's the channel **ID** like `C0123ABC`, not the name)
- `channel_not_found` → bot isn't a member → run `/invite @CEO Assistant` in the channel
- Auth error → wrong `SLACK_BOT_TOKEN`

---

## STAGE 7 — First meeting end-to-end [DEV]

**The AssemblyAI webhook cannot reach localhost.** You need ngrok (or similar) for local testing.

```bash
# Install ngrok (one-time)
brew install ngrok    # macOS
# or download from ngrok.com

# Tunnel port 4000
ngrok http 4000
```

Copy the `https://abc123.ngrok-free.app` URL. Add to `backend/.env`:
```
PUBLIC_API_URL=https://abc123.ngrok-free.app
```
Restart backend.

**Upload a meeting audio:**

1. Supabase dashboard → Storage → `meetings` bucket → Upload a test MP3 (~5-10 min audio recommended).
2. Click the file → copy the **public URL**.
3. Ingest:
```bash
curl -X POST http://localhost:4000/meetings/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test meeting — Q2 planning",
    "audioUrl": "<paste-public-url>",
    "meetingDate": "2026-05-15T14:00:00Z",
    "businessUnit": "NUTRITUNES",
    "attendees": [
      {"name": "Nalin Siriwardhana", "role": "CEO"},
      {"name": "Sasindi Welagedara", "role": "Project lead"}
    ]
  }'
```

4. Visit `http://localhost:3000/meetings`. Status flow:
   - `UPLOADED` → `TRANSCRIBING` (~30s-3min depending on length)
   - `TRANSCRIBING` → `EXTRACTING` (a few seconds — AssemblyAI webhook fires)
   - `EXTRACTING` → `COMPLETED` (~10-20s)

5. Click the meeting → you should see Summary, CEO Commitments, Key Decisions, Action Items, Open Questions.

If stuck on `TRANSCRIBING`:
- AssemblyAI webhook isn't reaching your ngrok URL → check ngrok is still running, restart backend
- Check Backend logs for "assemblyai.webhook" — if absent, webhook never arrived

---

## STAGE 8 — Production deploy [DEV]

### 8.1 Push to GitHub (private repo)
```bash
cd ceo-assistant
git init
git add .
git commit -m "Initial scaffold"
gh repo create ceo-assistant --private --source=. --push
# or: create via github.com UI, then git remote add + push
```

### 8.2 Backend → Railway
1. [railway.app](https://railway.app) → New Project → **Deploy from GitHub repo** → select `ceo-assistant`.
2. Railway detects the monorepo → set **root directory** to `backend`.
3. **Variables** tab → bulk import from your `backend/.env` (paste contents).
4. **Change `DATABASE_URL`** to point at Supabase, not local Postgres.
5. **Generate domain** → you get `https://ceo-assistant-production.up.railway.app`.
6. Set `PUBLIC_API_URL` and `ALLOWED_ORIGIN` (your future Vercel URL) in env vars.
7. Deployments → **View logs** → wait for "Listening on http://localhost:4000".

### 8.3 Run production migration
From your local machine:
```bash
cd backend
DATABASE_URL="<supabase-connection-string>" pnpm prisma migrate deploy
```

### 8.4 Frontend → Vercel
1. [vercel.com](https://vercel.com) → Add New → Project → import the GitHub repo.
2. Root directory: `frontend`.
3. Environment variables:
   - `NEXT_PUBLIC_API_URL=https://ceo-assistant-production.up.railway.app`
4. Deploy.
5. Once deployed → copy the Vercel URL → go back to Railway → update `ALLOWED_ORIGIN` to that URL.

### 8.5 Verify production
- `https://ceo-assistant-production.up.railway.app/health` → `{"ok":true}`
- Vercel URL → dashboard loads with 0/0/0 (fresh DB)
- Re-run STAGE 6 against production URL to confirm Slack still works.

---

## STAGE 9 — Gmail Push subscription [DEV]

Production-only because it needs a public webhook URL.

### 9.1 Create Pub/Sub topic
1. Google Cloud Console → Pub/Sub → Topics → **Create topic**.
2. Topic ID: `gmail-push`.
3. After creation, click the topic → **Permissions** tab → **Add Principal**:
   - New principal: `gmail-api-push@system.gserviceaccount.com`
   - Role: **Pub/Sub Publisher**

### 9.2 Create push subscription
1. Pub/Sub → Subscriptions → Create.
2. Subscription ID: `gmail-push-to-backend`.
3. Select topic: `gmail-push`.
4. Delivery type: **Push**.
5. Endpoint URL: `https://ceo-assistant-production.up.railway.app/webhooks/gmail`.
6. Acknowledgement deadline: 60 seconds.
7. *(Optional but recommended)* Enable authentication → service account → backend code can then verify the JWT in the `Authorization` header.

### 9.3 Tell Gmail to publish
This is a one-time Gmail API call. Use OAuth Playground (Stage 5) — you should still have an access token. If expired, redo the authorize step.

In OAuth Playground Step 3 (Configure request to API):
- HTTP Method: `POST`
- Request URI: `https://gmail.googleapis.com/gmail/v1/users/me/watch`
- Body:
```json
{
  "labelIds": ["INBOX"],
  "topicName": "projects/<YOUR_GCP_PROJECT_ID>/topics/gmail-push"
}
```
Click **Send the request**. Response should include `historyId` and `expiration`.

### 9.4 ⚠️ Gmail watch expires every 7 days
You **must** renew it before expiration or email automation silently stops. Add to your cron:
```yaml
# .github/workflows/renew-gmail-watch.yml
on:
  schedule:
    - cron: '0 0 * * 0'  # weekly, Sunday midnight UTC
jobs:
  renew:
    runs-on: ubuntu-latest
    steps:
      - run: |
          # POST /webhooks/gmail/renew-watch on backend (you'll need to add this endpoint)
          curl -X POST https://ceo-assistant-production.up.railway.app/webhooks/gmail/renew-watch
```

(The `renew-watch` endpoint isn't in the scaffold yet — add it; it's a 10-line route that calls `gmail.users.watch` with the stored refresh token.)

---

## STAGE 10 — Scheduled briefings [DEV]

Use GitHub Actions for cron (free, simple). Create `.github/workflows/morning-briefing.yml`:

```yaml
name: Morning Briefing
on:
  schedule:
    - cron: '0 10 * * 1-5'  # 10:00 UTC Mon-Fri = 6:00 AM EDT / 5:00 AM EST
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger morning briefing
        run: |
          curl -X POST https://ceo-assistant-production.up.railway.app/briefings/morning \
            -H "Authorization: Bearer ${{ secrets.BRIEFING_TRIGGER_SECRET }}"
```

(Add `BRIEFING_TRIGGER_SECRET` to GitHub repo secrets and add an auth check on the `/briefings/morning` endpoint — currently it's open.)

---

## GO-LIVE CHECKLIST

- [ ] **[CEO]** Added as test user in Google OAuth consent screen
- [ ] **[CEO]** Slack bot invited to `#ceo-briefings`
- [ ] **[DEV]** All env vars set in Railway and Vercel
- [ ] **[DEV]** Production Prisma migration run (`prisma migrate deploy`)
- [ ] **[DEV]** Test meeting successfully extracted end-to-end in production
- [ ] **[CEO]** First test draft successfully approved → sent to a test address
- [ ] **[CEO]** First morning briefing successfully posted to Slack
- [ ] **[DEV]** Gmail Push subscription active, weekly renewal cron set
- [ ] **[CEO]** VIP list populated via `POST /vips` for: legal counsel, board members, top buyers, family
- [ ] **[DEV]** Budget alerts set: Anthropic $100/mo, AssemblyAI $30/mo, Railway $20/mo
- [ ] **[DEV]** Audit log reviewed after week 1 (check `prisma studio` → AuditLog table for any unexpected agent activity)

---

## COMMON GOTCHAS

| Symptom | Cause | Fix |
|---|---|---|
| Email triage works but no draft created | `needsDraft: false` from Claude (newsletter, spam) | Expected behavior — only some emails get drafts |
| Meeting stuck at TRANSCRIBING | AssemblyAI webhook can't reach backend | Check ngrok / `PUBLIC_API_URL` env var |
| Slack message not delivered | Bot not in channel | `/invite @CEO Assistant` in `#ceo-briefings` |
| Gmail OAuth fails after 7 days | Watch expired | Renew via `users.watch` API call |
| Claude returns invalid JSON | Forced tool-use schema mismatch | Check `extract_meeting` tool schema vs prompt instructions |
| High Anthropic costs | Prompt cache not hitting | Verify `cache_control: ephemeral` is on the LAST block of system prompt, calls within 5 min |
| Production frontend can't reach backend | CORS | Set `ALLOWED_ORIGIN` env var in Railway to Vercel URL |

---

## WHAT TO BUILD NEXT (post-MVP)

In order of value:
1. **VIP detection refinement** — feed real VIP examples into the triage prompt as few-shot
2. **CEO voice training** — paste 50-100 historical CEO emails into a `voice-examples.ts` file, include excerpts in drafter system prompt
3. **End-of-day briefing** — clone `daily-briefing.ts`, change template, schedule at 6:00 PM ET
4. **Pre-meeting briefings** — Google Calendar integration + 30-min-before trigger
5. **Compliance auto-reviewer** — second Claude agent that scans every draft for FDA/FTC violations before showing in dashboard
6. **Memory layer** — Anthropic memory tool or vector DB once you have 100+ meetings and want cross-meeting context
