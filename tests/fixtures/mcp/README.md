Responses of `/api/mcp/*` captured from the sample stack (`scripts/capture-mcp-fixtures.sh`). Copy this folder into the prism-mcp repo and mirror the zod schemas from `src/lib/mcp/schemas.ts`. `tests/mcp/fixtures.test.ts` checks that every file here parses against those schemas.

Units: money is US dollars and `pct_increase` is percent ("4.1553" is 4.1553%), both decimal strings; dates are ET.
