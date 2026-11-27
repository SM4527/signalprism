# Changelog

## [Unreleased]

- Blue "Personal" badge in the nav when `DATA_MODE=live`; the SAMPLE DATA banner is mock-only.

## [0.1.0] - 2026-11-27

First release: a self-hosted Form 4 tracker for a personal watch list.

- Form 4 parser (zod-validated, parse errors never crash a poll), role normalizer and signal math with real and synthetic fixtures for every edge case.
- Signals: one per insider per filing from open-market purchases only; deterministic score with stored breakdown; 30-day clusters; plan-buy detection (10b5-1, ESPP, DRIP, 401(k)); amendments supersede earlier signals.
- SQLite storage with plain SQL migrations, WAL, and an in-process scheduler guarded by a lock row.
- Live poller: per-company submissions, shared 8 req/s limiter, declared User-Agent, backoff, 1 h pause on repeated 403, 13-month first-run history.
- Screens: Signals, Watchlist, Ticker, Rules, Status; dark-mode first, SAMPLE DATA banner on the sample stack.
- FolioPrism bridge: watch list from holdings and funds, held badges, host allowlist.
- Alerts: default CEO/CFO rule, Pushover client, quiet hours, digest, daily cap, deduplication, at-least-once outbox, test push.
- Read-only loopback API for Prism MCP: `/api/mcp/signals`, `/clusters`, `/ticker/[symbol]`, `/status`.
- Weekly retention of poll runs, failed fetches, notifications, audit lines and inactive companies.
- Docker Compose sample stack (port 8500, mock data) and separate personal stack; privacy scan and pre-push hook.
