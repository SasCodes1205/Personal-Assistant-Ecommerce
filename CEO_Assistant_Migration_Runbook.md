# CEO Assistant — Migration & Setup Runbook

**Goal:** Bring the existing build (Gmail + Slack + AssemblyAI) into compliance with the May 29 Master Plan (Microsoft 365: Outlook/Graph + Teams), add the compliance auto-reviewer, and finish setup through production go-live.

**Roles:** `[CEO]` = Nalin (accounts, consent, approvals). `[DEV]` = Sasandi (code + deploy). `[BOTH]` = joint session.

**How to use:** Work top to bottom. Stages 0–3 unblock everything else. Don't build to the Teams-transcript or license-dependent items until Stage 1 verification passes.

> **Verify-before-build note:** Microsoft platform specifics (Graph permission names, subscription expiry windows, license requirements for Teams transcription, Teams posting options) are point-in-time. Confirm each against current Microsoft Graph documentation before coding — this matches Section 8 of the Master Plan.

---

## STAGE 0 — Decisions to lock first `[BOTH]`

These three choices determine how the rest is built. Decide before any code.

- [ ] **Mailbox permission model.** App-only (application) Graph permissions with admin consent + an Exchange application access policy scoped to the CEO mailbox **(recommended for a 24/7 single-mailbox service)** — vs. delegated permissions with a stored token. Pick app-only unless there's a reason not to.
- [ ] **Teams posting method.** Power Automate "Workflows" incoming webhook **(recommended for MVP — one-way briefings, simplest)** vs. Graph `POST /channels/{id}/messages` (richer, but app-only channel posting is limited — verify current support). Start with the webhook.
- [ ] **Meeting transcript source priority.** Teams transcript via Graph as primary + AssemblyAI as fallback — *contingent on the M365 license check in Stage 1.* If the license doesn't support it, AssemblyAI stays primary for now.

---

## STAGE 1 — CEO prerequisites & verification `[CEO]` + `[DEV]`

- [ ] `[CEO]` **Book and complete the Entra app-registration session** (Stage 2). This is the one remaining CEO-side blocker.
- [ ] `[CEO]` **Populate the VIP list:** legal counsel, board members, top buyers (e.g. Whole Foods/Sprouts contacts), family. Hand Sasandi name + email + relationship + business unit for each (loaded in Stage 6 via `POST /vips`).
- [ ] `[DEV]` **Verify the M365 license** supports: (a) Teams meeting transcription, and (b) Graph transcript access (`OnlineMeetingTranscript.Read.All`). Note any transcript-availability delay after a meeting ends. **This gates the meeting pipeline and the "AssemblyAI → ~$0" cost claim.**
- [ ] `[DEV]` **Confirm feasibility + revised Week-1 timeline** on the Microsoft stack.

---

## STAGE 2 — Entra (Azure AD) app registration `[BOTH]`

Replaces the entire Google Cloud / OAuth-Playground setup (old SETUP Stages 2.4 and 5).

- [ ] `[CEO/admin]` Go to **portal.azure.com → Microsoft Entra ID → App registrations → New registration**.
  - Name: `CEO Assistant`
  - Supported account types: **Single tenant**
  - Register.
- [ ] From **Overview**, copy **Application (client) ID** and **Directory (tenant) ID**.
- [ ] **Certificates & secrets → New client secret** → copy the secret **value** immediately (shown once).
- [ ] **API permissions → Add a permission → Microsoft Graph → Application permissions**, add:
  - `Mail.Read`
  - `Mail.ReadWrite` (create drafts in Outlook Drafts)
  - `OnlineMeetingTranscript.Read.All` *(only if Stage 1 license check passed)*
  - `User.Read.All` *(resolve sender/VIP identities — verify if needed)*
- [ ] `[CEO/admin]` Click **Grant admin consent** for the tenant.
- [ ] **Scope mail access to the CEO mailbox only** (security control): in Exchange Online PowerShell, create an **application access policy** restricting the app to the CEO mailbox so app-only permissions don't expose the whole tenant. Document this in the security model.
- [ ] Save into the password manager: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `MS_MAILBOX` (CEO email/UPN).

---

## STAGE 3 — Code: dependencies & environment `[DEV]`

- [ ] Remove Gmail/Slack deps, add Microsoft ones:
  - Remove: `googleapis`
  - Add: `@azure/msal-node`, `@microsoft/microsoft-graph-client`, `isomorphic-fetch` (or undici)
- [ ] Update `backend/.env` and `lib/env.ts` — **remove → add**:

  | Remove (Gmail/Slack) | Add (Microsoft) |
  |---|---|
  | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GMAIL_USER_EMAIL` | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `MS_MAILBOX` |
  | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CEO_USER_ID`, `SLACK_BRIEFINGS_CHANNEL` | `TEAMS_WEBHOOK_URL` (Power Automate) **or** `TEAMS_TEAM_ID` + `TEAMS_CHANNEL_ID` |
  | — | `GRAPH_SUBSCRIPTION_CLIENT_STATE` (random secret to validate notifications) |
  | — | `PUBLIC_API_URL` (already present — needed for Graph webhooks) |

- [ ] Keep: `ANTHROPIC_API_KEY`, model env vars, `ASSEMBLYAI_API_KEY` + `ASSEMBLYAI_WEBHOOK_SECRET` (fallback path), `DATABASE_URL`, `SUPABASE_*`.
- [ ] Run local env up + Claude smoke test (unchanged from old SETUP Stages 3–4): `pnpm install` → `pnpm prisma migrate dev` → `pnpm dev` → `curl /health`.

---

## STAGE 4 — Code: Email module on Microsoft Graph `[DEV]`

Replaces `integrations/gmail.ts` and the Gmail webhook in `routes/webhooks.ts`.

- [ ] Create `integrations/graph-auth.ts`: MSAL `ConfidentialClientApplication`, client-credentials flow, token for `https://graph.microsoft.com/.default`.
- [ ] Create `integrations/graph-mail.ts`:
  - `listRecentMessages()` → `GET /users/{MS_MAILBOX}/mailFolders('Inbox')/messages`
  - `getMessage(id)` → single message (map to your `Email` model fields)
  - `createDraft({to, subject, body, ...})` → `POST /users/{MS_MAILBOX}/messages` (creates a reply draft in Outlook Drafts). Update `email-drafter.ts` to call this instead of the Gmail draft create.
- [ ] Rewrite the webhook handler in `routes/webhooks.ts`:
  - **Validation handshake:** on subscription creation Graph sends a `validationToken` query param — echo it back as `text/plain`, HTTP 200, within 10 seconds.
  - **On notification:** verify `clientState` matches `GRAPH_SUBSCRIPTION_CLIENT_STATE`, then fetch the changed message and run `triageEmail()` → `generateDraft()`.
- [ ] Add a **subscription create + renew** route/job:
  - `POST` Graph `/subscriptions` with `resource: "/users/{MS_MAILBOX}/mailFolders('Inbox')/messages"`, `changeType: "created"`, `notificationUrl: {PUBLIC_API_URL}/webhooks/graph`, `clientState`, and `expirationDateTime`.
  - **Mail subscriptions expire fast (under ~3 days — verify current limit).** The renewal cron must run **at least daily** (the old Gmail weekly cron is not frequent enough). Add a `lifecycleNotificationUrl` to catch reauth/expiry events.
- [ ] **Polling fallback** (Master Plan resilience requirement): a cron that polls `GET .../messages?$filter=receivedDateTime gt {lastSeen}` in case Graph notifications are delayed/unreliable.
- [ ] Local test with an ngrok tunnel (Graph can't reach localhost) → confirm a real inbox message produces a triage result and a draft.

---

## STAGE 5 — Code: Meeting pipeline (Teams primary, AssemblyAI fallback) `[DEV]`

Your `meeting-extractor.ts` extraction logic is reused — only the transcript source changes.

- [ ] Schema (`prisma/schema.prisma`): add to `Meeting`:
  - `transcriptSource` enum (`TEAMS | ASSEMBLYAI | UPLOAD`)
  - `graphTranscriptId String?`
  - Run `pnpm prisma migrate dev --name add_transcript_source`.
- [ ] Create a transcript abstraction so extraction is source-agnostic:
  - **Teams path** *(if Stage 1 passed):* Graph `/users/{id}/onlineMeetings/{meetingId}/transcripts` → `/content` returns **VTT**; parse VTT into speaker segments matching your existing `speakerSegments` shape.
  - **AssemblyAI path:** keep current code for uploaded/Zoom/in-person audio.
- [ ] Update meeting ingest: for Teams meetings, skip the Supabase upload step; for uploads, keep it.
- [ ] Test: one Teams meeting end-to-end → Summary, CEO Commitments, Key Decisions, Action Items, Open Questions populate.

---

## STAGE 6 — Code: Briefings & alerts on Teams `[DEV]`

Replaces `integrations/slack.ts`.

- [ ] If using **Power Automate webhook** (recommended): in the target Teams channel, create a **Workflows → "Post to a channel when a webhook request is received"** flow; copy the HTTP POST URL into `TEAMS_WEBHOOK_URL`.
- [ ] Create `integrations/teams.ts` with `postBriefing(markdown)` that POSTs an Adaptive Card (or simple message) to the webhook. Update `daily-briefing.ts` to call it.
- [ ] `[CEO]` Load the VIP list: `POST /vips` for each contact from Stage 1.
- [ ] Test: `curl -X POST {api}/briefings/morning` → briefing appears in the Teams channel.

---

## STAGE 7 — Code: Compliance auto-reviewer (pulled into Phase 1) `[DEV]`

New mandatory checkpoint per Master Plan Section 6. Your schema already supports it (`DraftStatus.AUTO_REJECTED`, `Draft.complianceFlags`).

- [ ] Create `agents/compliance-reviewer.ts`:
  - Input: a drafted reply (and later, any claim-bearing copy).
  - Classify **green / yellow / red**:
    - **Green** (CS replies, shipping, internal): pass.
    - **Yellow** (any structure/function language, product/ingredient claims): require the FDA disclaimer + flag for human review.
    - **Red** (disease/treatment claims, "proven"/cure, before-after, medical comparison, testimonial implying results): block.
  - Use a higher-tier model (Opus) given regulatory stakes.
- [ ] Wire into the draft flow: `generateDraft()` → compliance scan → set `PENDING_REVIEW` (green/yellow, with flags) or `AUTO_REJECTED` (red), store findings in `complianceFlags`.
- [ ] Surface compliance status + flags in the approval dashboard (drafts list and detail view).

---

## STAGE 8 — Code: security & auth gaps `[DEV]`

- [ ] Add auth to `POST /briefings/morning` (currently open) — bearer token check; matching secret in the cron.
- [ ] Confirm scopes are **read + draft only** — no send path exists without dashboard approval. Document this.
- [ ] Document the **security model**: where email/transcript content and API keys are stored, encryption at rest, and retention period for each.

---

## STAGE 9 — Governance (NIST AI RMF) `[DEV]` + `[CEO]`

- [ ] Add `GOVERNANCE.md` to the repo covering: intended uses, risk register, controls, human-approval points, logging (your `AuditLog` table), performance checks (the Week 1–3 gates), and incident response for unexpected agent behavior.
- [ ] *(Architectural decision — optional but cheap now)* Consider a generic `WorkItem` model so the Phase-2 PMO agent and the "single work graph" in Section 2.1 don't require a painful refactor later. Decide now while the schema is young.

---

## STAGE 10 — Production deploy `[DEV]`

- [ ] Push to a **private** GitHub repo.
- [ ] **Backend → Railway:** root dir `backend`; bulk-import env vars (the new Microsoft set, not Gmail/Slack); point `DATABASE_URL` at Supabase; generate domain; set `PUBLIC_API_URL` and `ALLOWED_ORIGIN`.
- [ ] Run production migration: `DATABASE_URL=… pnpm prisma migrate deploy`.
- [ ] **Frontend → Vercel:** root dir `frontend`; set `NEXT_PUBLIC_API_URL` to the Railway URL; deploy; copy Vercel URL back into Railway `ALLOWED_ORIGIN`.
- [ ] Verify: `/health` → ok; dashboard loads; Teams briefing works against production.

---

## STAGE 11 — Production subscriptions & crons `[DEV]`

- [ ] **Create the Graph mail subscription** against the production `PUBLIC_API_URL/webhooks/graph` (validation handshake must succeed).
- [ ] **Renewal cron — at least daily** (mail subs expire in under ~3 days). GitHub Actions or Railway cron hitting your renew endpoint.
- [ ] **Morning briefing cron:** Mon–Fri 6:00 AM ET (`0 10 * * 1-5` UTC during EDT — adjust for EST), with the auth secret from Stage 8.
- [ ] Set budget alerts: Anthropic $100/mo, AssemblyAI $30/mo, Railway $20/mo.

---

## GO-LIVE CHECKLIST (Week-3 gate)

- [ ] `[CEO]` Entra consent granted; mailbox access policy scoped to CEO mailbox only
- [ ] `[CEO]` VIP list loaded
- [ ] `[DEV]` Graph email: real-time notifications + polling fallback both working
- [ ] `[DEV]` Drafts land in Outlook Drafts; nothing auto-sends
- [ ] `[DEV]` Compliance reviewer scans every claim-bearing draft; red → AUTO_REJECTED
- [ ] `[DEV]` Meeting pipeline end-to-end (Teams or AssemblyAI fallback); ≥85% extraction on 5 real meetings
- [ ] `[DEV]` Email classifier ≥90% on 50-email sample; draft approval ≥70%
- [ ] `[DEV]` Teams morning briefing posts on schedule
- [ ] `[DEV]` Graph subscription renewal cron verified (run it once, confirm renewal)
- [ ] `[DEV]` Audit log reviewed after week 1
- [ ] `[CEO]` Runs email + meetings + briefing through the system 5 consecutive business days, no critical incidents

---

## What is NOT in this runbook (correctly deferred)

- **Phase 2** (profitability/commerce cockpit) and **Phase 3** (AI discoverability) — attach to this spine *after* Phase 1 go-live. No code today.
- **Inngest** — still optional; its value drops if Teams transcripts return quickly via Graph.
- **Final regulatory sign-off** — labels, claims, and advertising still require qualified regulatory counsel / supplement attorney before use. The compliance agent reduces risk; it does not replace counsel.
