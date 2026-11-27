import { ClustersQuery, buildClusters } from "@/lib/mcp/build";
import { mcpGet } from "@/lib/mcp/route";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => mcpGet(req, ClustersQuery, ({ db, query }) => buildClusters(db, query, new Date()));
