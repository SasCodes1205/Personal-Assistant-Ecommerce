# NUTRITUNES AI Operating System — Governance (Phase 1)

Aligned to the **NIST AI Risk Management Framework (AI RMF 1.0)** as required by the
Master Plan, Section 6. This document is the governance backbone for the CEO
Assistant. It is a living document — update it as the system changes.

> **Not legal advice.** The compliance reviewer reduces risk; it does **not**
> replace qualified regulatory counsel. Final labels, claims, and advertising
> require review by a supplement attorney / FDA regulatory consultant before use.

---

## 1. Intended uses (GOVERN / MAP)

| Use | In scope | Out of scope |
|---|---|---|
| Read the CEO mailbox, classify email, draft replies | Yes | Auto-sending email |
| Process Teams/AssemblyAI meeting transcripts into notes & action items | Yes | Recording or joining meetings |
| Post a daily briefing to a Teams channel | Yes | Posting to customers/public |
| Scan claim-bearing drafts for FDA/FTC compliance | Yes | Final regulatory sign-off |

The system is **approval-first**: AI may intake, triage, draft, classify, and surface —
it never publishes a health, label, or ad claim, and never sends email, without a human.

## 2. Risk register (MAP / MEASURE)

| ID | Risk | Likelihood | Impact | Control(s) |
|---|---|---|---|---|
| R1 | Non-compliant health/disease claim reaches a recipient | Med | High | Compliance reviewer (RED → AUTO_REJECTED); approval-first; counsel sign-off |
| R2 | Email auto-sent without review | Low | High | No `Mail.Send` scope; approval marks ready only; CEO sends from Outlook |
| R3 | Mailbox over-exposure via app-only Graph permission | Med | High | Exchange application access policy scoped to CEO mailbox only |
| R4 | Transcript over-exposure via app-only Teams permission | Med | Med | Teams application access policy scoped to CEO user only |
| R5 | Missed emails (Graph notification gap) | Med | Med | Lifecycle notifications + daily renewal + polling fallback |
| R6 | Wrong VIP classification (miss a board/legal email) | Med | Med | Curated VIP list; briefing surfaces VIP queue; human review |
| R7 | Model hallucinates a commitment/deadline from a meeting | Med | Med | Extraction prompt forbids invention; CEO reviews action items |
| R8 | Secret/key leakage | Low | High | Secrets in env/secret store only; least-privilege scopes; rotation |
| R9 | Cost runaway | Low | Med | Prompt caching; budget alerts (Anthropic/AssemblyAI/Railway) |

## 3. Controls (MANAGE)

- **Human approval points:** every outbound email draft; every claim-bearing piece of copy.
- **Compliance gate:** `agents/compliance-reviewer.ts` classifies GREEN/YELLOW/RED before the approval queue; RED is blocked (`AUTO_REJECTED`) and fails **closed**.
- **Least privilege:** Graph `Mail.Read`, `Mail.ReadWrite` only (no `Mail.Send`); transcript read scoped by access policy.
- **Tenant scoping:** Exchange + Teams application access policies restrict the app to the CEO's mailbox/user.
- **Resilience:** Graph lifecycle notifications, daily subscription renewal, and a polling fallback.

## 4. Logging & audit (MEASURE)

- Every Claude call and every state-changing action writes to the `AuditLog` table
  (`eventType`, `agent`, `model`, token counts, cost, `resultRefId`, payload).
- Tracked events include: `claude_call`, `draft_approved`, `draft_rejected`,
  `draft_auto_rejected`. Review weekly during rollout.

## 5. Performance checks (MEASURE) — the rollout gates

| Gate | Threshold |
|---|---|
| Meeting extraction accuracy (5 real meetings, manual review) | ≥ 85% |
| Email classifier accuracy (50-email sample) | ≥ 90% |
| Draft approval rate | ≥ 70% |
| Stability | 5 consecutive business days, no critical incidents |
| Compliance | Every claim-bearing draft scanned; RED never reaches the queue |

## 6. Incident response (MANAGE)

1. **Detect** — anomaly in audit log, a wrong send/classification, or a compliance miss.
2. **Contain** — disable the relevant cron/subscription; pause drafting if needed.
3. **Assess** — review audit-log payloads for the affected items.
4. **Correct** — fix the prompt/code; if a claim issue, route to counsel.
5. **Record** — log the incident, root cause, and fix in this document's changelog.

## 7. Data handling & retention (GOVERN)

- **What is stored:** email metadata + body text, draft text, meeting transcripts &
  notes, briefings, audit logs — in the Postgres/Supabase database.
- **Where:** managed Postgres (Supabase). API keys in the host's secret store (Railway)
  and local `.env` (never committed).
- **Encryption:** in transit (TLS) and at rest (provider-managed).
- **Retention:** _[SET A POLICY — e.g. transcripts 12 months, email bodies 24 months,
  audit logs indefinitely. Confirm with counsel.]_
- **Access:** CEO + project lead only. Single-tenant.

## Changelog

- _YYYY-MM-DD_ — Initial governance doc created during Microsoft 365 migration.
