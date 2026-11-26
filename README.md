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
