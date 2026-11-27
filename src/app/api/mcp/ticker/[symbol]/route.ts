import { buildTicker } from "@/lib/mcp/build";
import { mcpGet } from "@/lib/mcp/route";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return mcpGet(req, null, ({ db }) => buildTicker(db, symbol, new Date()));
}
