import { buildStatus } from "@/lib/mcp/build";
import { mcpGet } from "@/lib/mcp/route";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => mcpGet(req, null, ({ db, config }) => buildStatus(db, config.DATA_MODE, new Date()));
