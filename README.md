# SignalPrism

Self-hosted Form 4 tracker. It polls SEC EDGAR for a personal watch list, keeps only open-market purchases (code P), scores them into signals, detects clusters and sends Pushover alerts. Status: milestone 0 (skeleton); the parser and signals follow.

SignalPrism is a personal research tool, not investment advice.

## Sample stack

Runs on fixtures with `DATA_MODE=mock`; it never calls sec.gov or Pushover.

```
scripts/start.sh     # http://127.0.0.1:8500
scripts/logs.sh
scripts/stop.sh
```

## Watch list

Add or remove tickers by hand with the scripts inside the running container (tickers come only from the command line). The first `watch:add` loads the ticker map: from SEC in live mode, from a fixture in mock mode.

```
docker compose -f docker/compose.yaml exec app node scripts/watch-add.ts ACMR FLCN        # sample stack
docker compose --env-file .env.personal -p signalprism-personal -f docker/compose.personal.yml exec app node scripts/watch-add.ts TICKER   # personal stack
```

Use `scripts/watch-remove.ts` the same way. Unknown tickers are reported, not added.

The scheduler polls every 30 minutes on weekdays 06:00-22:30 ET and every 3 hours otherwise, so new tickers wait for the next tick. To poll right away (live mode only; the running scheduler does the poll and the script prints its counts):

```
docker compose --env-file .env.personal -p signalprism-personal -f docker/compose.personal.yml exec app node scripts/poll-now.ts
```

The container logs one line per scheduler event (started, lock claimed or waiting, tick ran or skipped, next tick in ET).

## FolioPrism

Set `FOLIOPRISM_URL` and the watch list is rebuilt from FolioPrism at start, daily, and with the "Refresh from FolioPrism" button on Watchlist: direct stocks plus the top 25 stocks held through funds. Funds are told apart by FolioPrism's own data, never by SEC company numbers. Manual tickers stay. Badges and the "Held now" filter show current holdings, so older signals show today's holdings. Holdings stay in memory; only `in_direct`, `in_funds`, `in_portfolio` and `held_via` are stored.

The host must be `127.0.0.1`, `localhost`, `[::1]`, `host.docker.internal` or listed in `PRISM_NET_HOSTS`, or the app refuses to start. FolioPrism stays bound to `127.0.0.1` on the host. From a container, `host.docker.internal` (mapped with `extra_hosts: host.docker.internal:host-gateway` in both compose files) reaches it; the sample stack uses `http://host.docker.internal:8420`, checked from inside the container. The personal stack sets `FOLIOPRISM_URL` in `.env.personal`.

Fallback if `host.docker.internal` does not reach FolioPrism: put both containers on one external Docker network (`docker network create prism-net`), attach both services to it, and set `FOLIOPRISM_URL=http://<folioprism-container>:<port>` with `PRISM_NET_HOSTS=<folioprism-container>`.

Watchlist add, remove and refresh are POST routes that answer loopback requests only (by `Host` and `Origin`).

## Alerts

A new CEO or CFO buy (default: at least $100K or a 10% holdings increase, not late, not a plan buy), or a cluster that gains an insider, becomes a held notification; the scheduler's lock holder sends it. Alerts never fire for history: a company's first poll and any filing more than 3 days old at ingest are recorded only. Quiet hours (ET) hold everything; the daily cap (default 10) sends the rest in one summary the next morning; an optional daily digest bundles the non-urgent ones. Everything is on the Rules page (edits are loopback-only POST forms), with "Send test push". Status shows Pushover usage from the API's limit headers.

Set `PUSHOVER_APP_TOKEN` and `PUSHOVER_USER_KEY` in `.env.personal` (never committed; they are only read by the client and never logged or stored). Without them, or on the sample stack, nothing is sent: the sample stack logs the would-be messages. `PUSH_PORTFOLIO_HINT` (`off`, `flag`, `detail`) seeds the Rules page setting; default `off`. Delivery is at-least-once: a crash during a request can repeat a push, never lose one.

Housekeeping runs weekly in the scheduler: poll runs older than 90 days, notifications older than a year, stored lines that did not become a signal older than 3 years, and the stored data (not the signals) of companies inactive for 90 days are deleted, then the database is vacuumed (`RETENTION_*` variables change the periods).

## Development

```
npm install
npm run lint
npm test
npm run privacy
```

Docker files live in `docker/`. A separate personal stack (`docker/compose.personal.yml`, started only by `scripts/personal-start.sh`) uses live data; its port is port 8510 and it is configured in `.env.personal`, which is never committed. It pairs with the personal FolioPrism on port 8430.

Pushover alerts reveal which stocks you follow to an outside service; enable Pushover end-to-end encryption.

License: MIT.
