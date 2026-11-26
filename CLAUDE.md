# CLAUDE.md — SignalPrism

Build **SignalPrism**, a self-hosted Form 4 tracker for a personal watch list: poll SEC EDGAR for the companies the user holds (from FolioPrism) and a short watchlist, keep only open-market purchases (code P), group them into scored signals, detect clusters, and send Pushover alerts. The default alert rule is CEO or CFO buys of ≥ $100K or a ≥ 10% holdings increase. It serves a read-only local API for Prism MCP. The full plan is in `.notes/PLAN.md`. It is a research tool, not investment advice; keep that line in the README and UI footer.

**v1 scope:** watch list only, polled per company. Market-wide polling, the superinvestor (13F) badge and price tracking are v2. Don't build them unless asked.

## Privacy (mandatory)

The user runs SignalPrism on a separate personal stack linked to their real FolioPrism portfolio. The watch list itself reveals what they hold.

- Develop, test and demo only on fixtures and the **sample** stack on `http://127.0.0.1:8500` (Compose project `signalprism-sample`, `DATA_MODE=mock`).
- Never read `data/local/`, `.env.personal`, the personal database or its watch list. Never start, stop, call or read logs from the personal stack (`:8510`, project `signalprism-personal`) unless the user explicitly asks in the current session, and then only a health check.
- Never call FolioPrism's personal stack (`:8430`). The sample stack pairs only with sample FolioPrism (`:8420`).
- Never put `8510` or `8430` in committed code, config, fixtures or tests; the README may mention each once, in prose.
- Never ask for, read or write `PUSHOVER_APP_TOKEN`, `PUSHOVER_USER_KEY` or `SEC_USER_AGENT` values. Tests use fake Pushover and fake SEC servers. The sample stack never calls `api.pushover.net` or `sec.gov`; it logs would-be messages.
- Fixtures are real public Form 4 filings and submissions JSON from large, well-known companies chosen for edge cases. The sample watch list is made up. Never pick fixtures or examples from the user's holdings, and never ask what they hold.
- Cases no real filing covers use hand-written `synthetic_*.xml` fixtures: real Form 4 structure, made-up issuers, people and CIKs, each with a one-line note in `tests/fixtures/form4/NOTES.md`.
- Screenshots come only from the sample stack.

## App rules

- **Source:** SEC EDGAR only (`data.sec.gov/submissions/`, Form 4 XML, `company_tickers.json`). Never scrape Dataroma, OpenInsider or any other site.
- **Money and shares:** never use JS `number` for shares, prices, values or percentages. Use `decimal.js`; store as TEXT. Value = Σ(shares × price) per line.
- **Signal:** one insider × one filing, summing that insider's non-derivative P lines. Alerts are per signal and per cluster growth, never per line.
- **Filtering:** only non-derivative (Table I) code P lines with a price create a signal or count toward `signal.shares` and `signal.value`. Never treat option exercises (M), grants/awards (A), conversions (C) or tax withholdings (F) as purchases. When the Form 4's 10b5-1 box is ticked the signal has `plan_10b51 = true`: it is shown with a "10b5-1 plan" badge (hidden by default in Signals), never matches an alert rule, never counts in a cluster and gets no first-buy points. A 10b5-1 footnote mention only sets `plan_suspected`. All other lines are stored for audit, never alerted.
- **Holdings increase:** group Table I lines by (`security_title`, `ownership_form`, `nature_of_ownership`). In each bucket, `owned_before = min(owned_after) − that line's shares − same-day Table I M shares in that bucket`. M lines affect only this baseline, and only when paired with a same-day P line. Then add the shares owned in the filing's `nonDerivativeHolding` rows (stored as `table_no = 'I-holding'`) of the same security (title compared case- and space-insensitively) that are not one of the P buckets. The signal's `owned_before` is that total; `≤ 0` means "New position", never a division.
- **Late filings:** `lag_days` counts business days, excluding weekends and NYSE/SEC federal holidays from the static 2025–2030 list in `src/lib/sec/holidays.ts`; late means > 2.
- **Lookbacks:** "first buy in 12 months" is relative to `signal.txn_date`, never `now()`. The initial 12-month backfill is ingested in chronological ascending order.
- **Roles:** normalize free-text titles to `CEO / CFO / COO / PRESIDENT / OTHER_OFFICER / DIRECTOR / HOLDER_10PCT / OTHER` (OTHER = only the isOther flag; shown, never alerted, never counted in clusters), keep the raw title, and keep the normalizer's test table up to date.
- **Default rule:** CEO or CFO, value ≥ $100K or increase ≥ 10% (incl. New position), not late, not 10b5-1. Directors off by default (≥ $250K when on); 10% owners off. Clusters: 2+ distinct insiders within 30 days, at least one officer; count distinct insiders by `owner_cik` (fallback: normalized `owner_name`), never `reporting_owner.id`; joint filers count once.
- **Amendments (4/A)** supersede the earlier signal; no re-push unless value changes by more than 20%.
- **Parser:** read every field through zod; a surprise becomes `parse_error`, never a crash of the poll.
- **SEC access:** every request sends `SEC_USER_AGENT` (refuse to start in live mode without it); one shared limiter at 8 req/s; exponential backoff on 429/403/503; after repeated 403s pause an hour and show a banner. Fetch a Form 4 only for accession numbers not seen before.
- **FolioPrism:** GET only (`/api/holdings`, `/api/analysis`). `FOLIOPRISM_URL` host must be `127.0.0.1`, `localhost`, `[::1]`, `host.docker.internal` or listed in `PRISM_NET_HOSTS`, else refuse to start. Holdings stay in memory; store only `in_portfolio` and `held_via`.
- **Pushover:** title ≤ 250, message ≤ 1024, URL ≤ 512 characters. Portfolio info follows `PUSH_PORTFOLIO_HINT` (default `off`). Dedup per (rule, signal) and (rule, cluster, insider count). Quiet hours, digest, daily cap. No emergency priority. Held and digest alerts are persisted in `notification_log` (`status`, `payload_json`) so restarts never drop pushes.
- **Logs and `notification_log`:** never tokens, keys or holdings; `payload_json` holds only the message title, body, URL and priority.
- **Watch list sources:** boolean columns `in_direct`, `in_funds`, `in_manual` on `company` (a company can be in several).
- **SQLite and scheduler:** set `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000` on DB init. Boot the scheduler once from `instrumentation.ts` only when `NEXT_RUNTIME === 'nodejs'`, guarded by the SQLite lock row.
- **API:** bind to `127.0.0.1`. `/api/mcp/*` is GET only and answers loopback requests only.
- **Score:** deterministic, weights in one config file, breakdown stored and shown. No AI model in scoring or filtering.

## Stack

Next.js 16 (App Router), TypeScript strict, Node 24, Tailwind v4, shadcn/ui, SQLite (better-sqlite3, plain SQL migrations), fast-xml-parser + zod, in-process scheduler with a lock row, Vitest, Playwright.

## Layout

- `src/lib/sec/` — EDGAR client, rate limiter, submissions reader, Form 4 parser, title normalizer, ticker map
- `src/lib/signals/` — signal builder, score, cluster detector, rule evaluator
- `src/lib/watchlist/` — watch list builder, FolioPrism client
- `src/lib/notify/` — Pushover client, formatter, quiet hours, digest
- `src/app/api/mcp/` — read-only JSON for Prism MCP
- `tests/fixtures/form4/` — `<accession>.xml` plus a one-line note of the case it covers
- `tests/fixtures/submissions/` — sample-company submissions JSON
- `tests/sec/` — one test per parser edge case in PLAN section 6
- `scripts/` — `start.sh`, `stop.sh`, `restart.sh`, `logs.sh`, `personal-start.sh`

## Working style

- One milestone at a time (PLAN section 14); start in plan mode; stop at the end of each milestone for review.
- Before calling a milestone done: `npm test`, `npm run lint`, migrations apply on a fresh database, sample stack starts on :8500.
- Ask before adding a dependency.
- Dense, scannable, dark-mode-first UI matching FolioPrism. Yellow SAMPLE DATA banner on the sample stack.
- If a task seems to need live SEC data or personal data, stop and ask the user.
