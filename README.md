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
