# Gexart Sales CRM — Development guide

Internal sales CRM for Gexart. One Cloudflare Worker serves both the API (`/api/v1/*`, Hono) and the
React single-page app (static assets). Data lives in D1; files (sales assets, generated PDFs/decks,
call recordings, import previews) live in private R2. Background work runs on a Cloudflare Queue, and a
15-minute cron sends reminders and enforces data retention. The `android/` folder holds the phone companion app.

> This project lives in its own folder, `D:\SOFTWARE DEVELOPMENT\gex sales`. Run all commands from there.
> It is not a git repository yet (`git init` before the first commit).

## Stack

| Layer | Choice |
|---|---|
| UI | React 19 + TypeScript, Vite 8, Tailwind CSS 4, Lucide icons, TanStack Query, React Router 8 |
| API | Hono on Cloudflare Workers (`worker/`) |
| Database | Cloudflare D1, versioned SQL migrations (`migrations/`) |
| Files | Cloudflare R2 (binding `FILES`), streamed only through authorised API routes |
| Jobs | Cloudflare Queue `gexart-crm-jobs` (audits, call transcription); falls back to `waitUntil` |
| AI | Claude via `@anthropic-ai/sdk` (`claude-opus-5-5`, structured outputs, server-side fallback); Whisper on Workers AI for calls |
| Documents | `pdf-lib` (fixed-format proposal PDF, server) · `pptxgenjs` (decks, built in the browser from a reviewed outline) |
| Phone app | Kotlin, minSdk 26, WorkManager + Storage Access Framework (`android/`) |
| Validation | Zod schemas in `shared/schemas.ts`, enforced on the server and reused by forms |
| Dev runtime | `@cloudflare/vite-plugin` runs the Worker inside `workerd` with local D1 |

## Layout

```
gex sales/
  migrations/           D1 migrations (0001 core, 0002 audit engine, 0003 catalogue seed, 0004 outreach centre,
                        0005 operations & intelligence)
  shared/               enums, Zod schemas and the placeholder engine (templating.ts) shared by Worker and UI
  worker/
    index.ts            Hono app, middleware order, route mounting
    entities.ts         CRUD definitions per entity (search, filters, scoping, hooks)
    jobs.ts             queue producer/consumer (audits, transcription)
    lib/                auth, entity engine, audit log, http, providers (Claude, Brevo, Places, YouTube,
                        Hunter, Apollo, RocketReach, Lusha + daily quotas), qualification, pdf
    routes/             auth, users, crm, dashboard, audits, outreach, brevo (+ webhook), assets, imports
                        (+ export), discovery (Places, contact finder, qualification), sales (pitch, proposal,
                        deck, price book, line items), calls (+ device API), integrations, notifications (+ cron)
    audits/             crawler, rubrics (website/SEO/AEO), extra (tech & automation, social, GBP, competitor),
                        run (executor), registry
  src/
    components/         ui primitives, layout (sidebar/top bar/search), forms, record widgets
    pages/              dashboard, generic list/detail, account workspace, audits, pipeline, settings
  android/              Gexart Calls companion app (see android/README.md)
  scripts/smoke.mjs     end-to-end API checks against a running dev server
  test/                 Vitest unit tests (pure logic)
  docs/AUDIT_SCORING.md audit rubrics and formulas
```

## Local development

Requirements: Node 20+ (tested on Node 25), npm.

```bash
npm install
```
```bash
npm run db:migrate:local
```
```bash
npm run dev
```

Open http://localhost:5173. On an empty database the app shows **first-run setup**: the first account
created becomes the administrator and the setup endpoint closes permanently once any user exists.
Further users are added by an administrator in **Settings → Users & roles**.

Local D1 data lives in `.wrangler/state` (git-ignored). Delete that folder and re-run the migration to start fresh.

### Local test accounts

The local database used during development was initialised with this **local-only** administrator
(it exists only in your `.wrangler/state`, never in production):

- Email: `admin@gexart.test`
- Password: `LocalDevOnly-2026`

`scripts/smoke.mjs` uses these by default (override with `SMOKE_ADMIN_EMAIL` / `SMOKE_ADMIN_PASSWORD`).
Each smoke run creates uniquely named records and a `rep-*@gexart.test` user.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite + Worker (workerd) with HMR on port 5173 |
| `npm run typecheck` | `tsc -b` for the app and Worker projects |
| `npm test` | 33 Vitest unit tests (robots, rubrics, tech detection, qualification, CSV, PDF, templating, scheduling) |
| `node scripts/smoke.mjs [baseUrl]` | 129 end-to-end API checks against the running dev server |
| `CF_REMOTE_BINDINGS=1 npm run dev` | Dev with remote bindings (Workers AI) after `wrangler login` |
| `npm run build` | Typecheck and build the client and Worker bundles into `dist/` |
| `npm run db:migrate:local` / `:remote` | Apply pending D1 migrations |
| `npm run deploy` | Build and `wrangler deploy` |

## Migrations

- Never edit an applied migration. Add `migrations/000N_description.sql` and apply it.
- Allowed values for status/type columns are mirrored in `shared/enums.ts` (CHECK constraints in SQL).
  Changing an allowed list means a new migration that rebuilds the table, plus the enum change.
- Money is stored as integer minor units with a currency code; timestamps are UTC ISO strings.
- D1 has no interactive transactions. Multi-record operations (prospect conversion, audit results)
  use `db.batch()`, which is atomic: if one statement fails the whole batch rolls back.

## Environment, bindings and secrets

| Name | Kind | Required | Notes |
|---|---|---|---|
| `DB` | D1 binding | yes | `wrangler.jsonc` → `d1_databases` |
| `FILES` | R2 binding | yes | `gexart-crm-files` bucket (private) |
| `JOBS` | Queue binding | recommended | `gexart-crm-jobs`; without it jobs run in `waitUntil` |
| `AI` | Workers AI binding | for call transcripts | Remote-only; unavailable in plain local dev |
| cron `*/15 * * * *` | trigger | yes | Reminders, session cleanup, 30-day Places retention |
| `APP_NAME`, `DEMO_MODE` | vars | no | Display name; demo flag (unused) |
| `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | vars | for Brevo | Sender must be verified in Brevo |
| `QUOTA_GOOGLE_PLACES`, `QUOTA_ENRICHMENT`, `QUOTA_CLAUDE`, `QUOTA_YOUTUBE` | vars | no | Daily call caps (0 disables) |
| `ANTHROPIC_API_KEY` | secret | no | Claude pitches, deck outlines, call summaries. Templates are used without it |
| `BREVO_API_KEY`, `BREVO_WEBHOOK_SECRET` | secrets | no | Sending + delivery webhook (`/api/v1/webhooks/brevo?token=…`) |
| `GOOGLE_PLACES_API_KEY` | secret | no | Lead discovery and Google Business Profile audit |
| `YOUTUBE_API_KEY` | secret | no | YouTube activity in the social audit |
| `HUNTER_API_KEY`, `APOLLO_API_KEY`, `ROCKETREACH_API_KEY`, `LUSHA_API_KEY` | secrets | no | Contact finder providers (the company-website source is free and always on) |

Local secrets go in `.dev.vars` (copy `.dev.vars.example`; git-ignored). Production secrets:
`npx wrangler secret put BREVO_API_KEY`. Secrets are only read inside the Worker and never sent to the browser.

## Deploying to Cloudflare

Not yet performed for this project. Steps:

1. `npx wrangler login`
2. `npx wrangler d1 create gexart-crm` → put the printed `database_id` into `wrangler.jsonc`.
3. `npx wrangler r2 bucket create gexart-crm-files`
4. `npx wrangler queues create gexart-crm-jobs`
5. API keys, the Brevo sender and daily limits are set by an admin in **Settings → Configuration** (encrypted in D1,
   overriding Worker vars/secrets of the same name). `wrangler secret put NAME` still works. Optionally set a
   `SETTINGS_ENCRYPTION_KEY` secret first so saved keys are encrypted with a key held outside the database.
6. `npm run db:migrate:remote`
7. `npm run deploy`
8. Open the deployed URL and create the administrator on the setup screen **immediately**
   (until a user exists, anyone who can reach the URL could claim it). For extra protection, put the
   Worker behind Cloudflare Access for your team.
9. In **Settings → Integrations**, validate each provider you added. For Brevo, add the webhook URL shown there
   in Brevo → Transactional → Webhooks (events: delivered, hard/soft bounce, blocked, invalid, unsubscribed, spam).
10. Build the Android app (`android/README.md`) and pair phones in **Settings → Phone app**.
11. Smoke test: `node scripts/smoke.mjs https://<your-worker>.workers.dev` after setting
   `SMOKE_ADMIN_EMAIL` / `SMOKE_ADMIN_PASSWORD` (note: it creates test records).

**Rollback:** `npx wrangler rollback` restores the previous Worker version. D1 migrations are forward-only;
take a backup first with `npx wrangler d1 export gexart-crm --remote --output backup.sql`, and use
D1 Time Travel (`wrangler d1 time-travel restore`) to recover data.

## Security model

- Sessions: random 256-bit token in an `HttpOnly; Secure; SameSite=Lax` cookie; only its SHA-256 is stored.
- Passwords: PBKDF2-SHA256, 100k iterations (Workers maximum), per-user salt; iteration count stored per user.
- CSRF: every mutating request must send `X-Requested-With: gexart-crm`, and any `Origin` must match the host.
- Rate limiting: failed sign-ins are counted per email (8/15 min) and per IP (30/15 min) in D1.
- Authorization is enforced in the Worker on every request: admins (everything), managers (all sales
  data, reports, integrations view), reps (records they own; contacts/deals under accounts they own;
  tasks assigned to or created by them; no catalogue edits; internal product cost stripped).
- Outreach: a message becomes "sent" only through an explicit, confirmed user action (manual workflow) or a
  successful Brevo API call on an approved message; Brevo status changes only via the token-authenticated webhook. Confirmations are idempotent via a unique key in `webhook_events`.
  Placeholders are a fixed allow-list rendered as plain text; values are never evaluated, and `escapeHtml` is used
  before any HTML email is produced.
- Audit log: creates, updates (with field diffs), archives, conversions, stage changes, assessments,
  audit runs, logins, permission changes and integration validations.
- External content (websites, transcripts, imports) is wrapped as untrusted data in every Claude prompt; AI output
  is labelled as a draft and is never sent or saved to records without a user action.
- Files: R2 objects are never public; downloads stream through visibility checks. Confidential assets are visible
  only to their owner and managers. Uploads are type- and size-checked; CSV exports neutralise formula injection.
- Phone devices use per-device bearer tokens (hash stored, revocable); the device API is exempt from CSRF only
  because it uses no cookies. Uploads are idempotent per device + call reference.
- Paid APIs have daily quotas (`integration_usage`); Google Places results are deleted after 30 days.
- Audit crawler: http/https only, refuses localhost/private IPs/credentials, obeys robots.txt,
  identifies itself (`GexartAuditBot/1.0`), bounded to 5 pages + 25 link checks, 10 s timeouts.

## Known limitations

See `PROGRESS.md` for the live list.

## Sales autopilot and Harvey bridge

- **Autopilot** (`worker/autopilot/`, page `/autopilot`): playbooks discover leads (Google Places and/or existing
  prospects), research each website, draft a 3-email sequence (Claude, or a template), hold it in the **Outbox** for
  approval, send from a connected **Google Workspace** mailbox (Gmail API, OAuth) inside a send window and a warm-up
  ramped daily cap, follow up in-thread, and read replies every 15 minutes (cron → queue job `autopilot`).
- Compliance is deterministic (`worker/autopilot/rules.ts`): opt-out wording, bounces and out-of-office are classified
  by rules, not a model; opt-outs and bounces go to the shared `do_not_contact` list, which is checked at research,
  approval and send time. Every cold email carries an opt-out line and `COMPANY_POSTAL_ADDRESS`; a playbook can't
  start without it. Playbooks pause automatically when more than 5% of a week's sends bounce. Replies are always
  drafted for a human to approve.
- Google setup: OAuth client (Web), Gmail API enabled, consent screen **Internal**, redirect URI
  `<origin>/api/v1/mailboxes/google/callback`. Client ID/secret go in Settings → Configuration.
- **Harvey bridge** (`worker/routes/harvey.ts`, `integrations/harvey/`): a `harvey` device token lets
  `crm_sync.py` on the user's PC push Harvey's prospects and conversation events and pull the do-not-contact list.
- **Revenue cockpit** (`/cockpit`, `revenue_goals`): monthly target vs closed-won, gap, run-rate and today's moves.
