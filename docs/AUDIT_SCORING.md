# Audit scoring

Source of truth: `worker/audits/rubrics.ts`. Every run stores the rubric version (`website-1.0`, `seo-1.0`,
`aeo-1.0`) so historical scores stay interpretable when rubrics change.

## Check results

| Result | Meaning | Counts toward score |
|---|---|---|
| pass | The check's condition was observed | full weight |
| warn | Partially met | half weight |
| fail | Not met, with evidence | 0 |
| unavailable | Could not be evaluated (no data, network error) | excluded |

Missing data is never treated as a pass.

## Formulas

- **Category score** = (Σ weight of passes + ½ Σ weight of warnings) ÷ Σ weight of assessed checks × 100.
  A category with no assessed checks has no score ("N/A").
- **Overall score** = Σ(category score × category weight) ÷ Σ(weights of categories that have a score).

A score of 100 means the defined checks passed on the pages inspected. It does not measure search rankings,
traffic, conversions or visibility in AI answers.

## Category weights

| Website audit | | SEO audit | | AEO audit | |
|---|---|---|---|---|---|
| Availability & security | 25 | Titles & meta descriptions | 30 | Answerability | 30 |
| Mobile & UX basics | 20 | Indexability | 25 | Extractable structure | 20 |
| Lead capture & conversion | 25 | Content structure | 20 | Source credibility | 25 |
| Accessibility indicators | 15 | Internal linking | 15 | Freshness signals | 10 |
| Performance indicators | 15 | Structured & social metadata | 10 | Crawlability | 15 |

## Scope

Each run inspects the homepage plus up to 4 internal pages (favouring about/contact/services/pricing/FAQ),
checks up to 25 further internal links, and reads robots.txt and the sitemap. Pages disallowed by robots.txt
are skipped and listed. The report always shows which pages were inspected.

## Findings → services

Each failed or partial check lists catalogue SKUs it relates to (e.g. metadata → `GX-MKT-SEO`, viewport →
`GX-TEC-WEB`, missing enquiry form → `GX-MKT-WEB`, `GX-TEC-CRM`). Only SKUs that exist and are active in the
catalogue are suggested, and marking them "Relevant" never downgrades a service already discussed, proposed,
won or lost.
