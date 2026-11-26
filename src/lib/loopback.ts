const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const hostnameOf = (hostOrOrigin: string): string | null => {
  const url = hostOrOrigin.includes("://") ? hostOrOrigin : `http://${hostOrOrigin}`;
  return URL.canParse(url) ? new URL(url).hostname : null;
};

/**
 * Loopback-only check for write routes. Inside Docker the peer address is the bridge gateway, so the check
 * is on the `Host` header; the compose files publish the port on 127.0.0.1 only. A browser POST also
 * carries `Origin`, which must be loopback too (stops another site from posting to this one).
 * Returns a 403 response to send, or null when the request may go on.
 */
export function rejectUnlessLoopback(req: Request): Response | null {
  const host = hostnameOf(req.headers.get("host") ?? "");
  const origin = req.headers.get("origin");
  const originHost = origin === null ? "127.0.0.1" : hostnameOf(origin);
  const ok = host !== null && LOOPBACK.has(host) && originHost !== null && LOOPBACK.has(originHost);
  return ok ? null : new Response("Loopback requests only", { status: 403 });
}
