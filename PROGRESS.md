# Gexart Sales CRM — Progress

Last updated: 2026-10-29

## Status

All phases from both briefs are implemented: 1–5 and A–F. The CRM runs locally from
`D:\SOFTWARE DEVELOPMENT\gex sales`. It is **not deployed** and **not committed** (no git repository yet).

| Area | Status |
|---|---|
| Foundation, auth, roles, shell, dashboard (1 / A) | ✅ |
| Accounts, contacts, products, campaigns, prospects, conversion, search (2) | ✅ |
| Account intelligence workspace, service fit, audit workspace (B) | ✅ |
| Audits: website, SEO, AEO, technology & AI automation, social, Google Business Profile, competitor (C) | ✅ (GBP needs a Places key; social metrics beyond YouTube need the business's own connection) |
| Pipeline, tasks, timelines, Outreach Centre, templates, sequences (3) | ✅ |
| Sales assets on R2, versions, CSV import/export, reports, notifications (4) | ✅ |
| Pitch generator, fixed-format PDF proposal, Claude-outlined PPTX decks, price book, deal line items (D) | ✅ |
| Lead discovery (Google Places), contact finder (website, Hunter, Apollo, RocketReach, Lusha), qualification (E) | ✅ (providers need keys) |
| Brevo send + webhook, queues, cron, quotas, rate limits, call recordings + Android app (5 / F) | ✅ code complete · ⏳ deploy |

## Verified (2026-10-29)

- `npm run typecheck` — clean. `npm run build` — passes (client 712 kB / 201 kB gzip; pptxgenjs lazy-loaded).
- `npm test` — **33/33** unit tests.
- `node scripts/smoke.mjs` — **129/129** end-to-end checks, including: price book and line items (deal value =
  first-year value), private asset upload/download/versioning (new versions keep name and confidentiality),
  CSV import validation/duplicates/no double-commit, export redaction, discovery and contact-finder error
  handling, qualification + override, all 7 audit types registered, template pitch/proposal/deck, real PDF output,
  .pptx upload, integration hub permissions, Brevo guards and webhook auth, the full phone-app flow (token,
  lookup, matched upload, idempotent re-upload, range-streamed audio, rep isolation, revocation).
- Browser: Settings (Integrations, Phone app), notifications bell, account Sales material (pitch, deck outline →
  built a valid 7-slide .pptx in the browser), price book, sales assets, import, discovery, calls, deal line
  items, prospect qualification, reports.
- The PDF proposal was rendered to images and checked page by page. Fixed: a heading stranded at the bottom of
  a page, and cramped price columns.

## Not verified (needs your accounts or devices)

- **Android app**: written as a full Android Studio project, but not compiled (no Android SDK on this machine).
  Build it in Android Studio (`android/README.md`).
- **External providers**: Claude, Brevo, Google Places, YouTube, Hunter, Apollo, RocketReach and Lusha are coded
  against their documented APIs but untested with live keys. Validate each in Settings → Integrations after adding keys.
- **Workers AI transcription**: runs only on the deployed Worker (or local dev with `CF_REMOTE_BINDINGS=1`).
- **Cloudflare deployment**: needs `wrangler login`. Follow DEVELOPMENT.md → Deploying.

## Known limitations

- Audits read server-rendered HTML only and inspect a bounded set of pages. Speed is a single server-side
  measurement, not Lighthouse.
- Instagram/Facebook/LinkedIn metrics are not scraped. They need the business's own authorised connection.
- Apollo/RocketReach/Lusha free tiers give few or no API credits. The free "company website" source is always available.
- Google Places data is kept 30 days (provider terms). Imported prospects keep only what the user confirmed.
- Pipeline-by-stage bars format amounts as INR. Mixed-currency pipelines are summed per currency only in KPIs.
- Brevo replies are not reported by transactional webhooks; replies are still recorded by users.
- Call recording depends on the phone dialer's built-in recorder (Android blocks third-party call recording).

## External credentials still required

Cloudflare account (D1 id, R2 bucket, queue) · optional: Anthropic, Brevo (+ verified sender, webhook secret),
Google Places, YouTube Data API, Hunter, Apollo, RocketReach, Lusha.

## Next recommended step

Deploy to Cloudflare, add the keys you want, validate them in Settings → Integrations, then build and pair the Android app.
