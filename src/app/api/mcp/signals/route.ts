import { SignalsQuery, buildSignals } from "@/lib/mcp/build";
import { mcpGet } from "@/lib/mcp/route";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => mcpGet(req, SignalsQuery, ({ db, query }) => buildSignals(db, query, new Date()));
