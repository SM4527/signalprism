import { LIMITS, type Alert } from "./format";

const TIMEOUT_MS = 10_000;

/** Pushover's per-app monthly limit headers (`X-Limit-App-*`). Null when a header is missing. */
export interface PushoverUsage {
  limit: number;
  remaining: number;
  /** ISO time the monthly counter resets. */
  resetAt: string;
}

export type SendResult =
  | { kind: "sent"; usage: PushoverUsage | null }
  /** A 4xx: the message or the credentials are wrong; retrying cannot help. */
  | { kind: "rejected"; status: number; usage: PushoverUsage | null }
  /** A 5xx or a network error: try again later. `error` is a short class name, never a message with secrets. */
  | { kind: "retry"; error: string };

/** What delivery needs from Pushover; tests and the mock stack use other implementations or none. */
export interface Sender {
  send(alert: Alert): Promise<SendResult>;
}

function readUsage(h: Headers): PushoverUsage | null {
  const limit = parseInt(h.get("x-limit-app-limit") ?? "", 10);
  const remaining = parseInt(h.get("x-limit-app-remaining") ?? "", 10);
  const reset = parseInt(h.get("x-limit-app-reset") ?? "", 10);
  return [limit, remaining, reset].some(Number.isNaN)
    ? null
    : { limit, remaining, resetAt: new Date(reset * 1000).toISOString() };
}

/**
 * Posts to `<baseUrl>/1/messages.json`. The app token and user key live only in this object's private fields:
 * they go out in the request body and are never put in a log, an error, a result or the database.
 */
export class PushoverClient implements Sender {
  readonly #token: string;
  readonly #user: string;
  readonly #baseUrl: string;

  constructor(o: { token: string; user: string; baseUrl: string }) {
    this.#token = o.token;
    this.#user = o.user;
    this.#baseUrl = o.baseUrl;
  }

  async send(alert: Alert): Promise<SendResult> {
    const form = new URLSearchParams({
      token: this.#token,
      user: this.#user,
      title: alert.title.slice(0, LIMITS.title),
      message: alert.body.slice(0, LIMITS.message),
      priority: String(alert.priority),
    });
    if (alert.url) {
      form.set("url", alert.url.slice(0, LIMITS.url));
      form.set("url_title", "Open filing");
    }
    let res: Response;
    try {
      res = await fetch(new URL("/1/messages.json", this.#baseUrl), {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return { kind: "retry", error: (e as Error).name };
    }
    const usage = readUsage(res.headers);
    if (res.ok) return { kind: "sent", usage };
    if (res.status >= 400 && res.status < 500) return { kind: "rejected", status: res.status, usage };
    return { kind: "retry", error: `HTTP ${res.status}` };
  }
}

/** The client for the environment, or null when the token or user key is missing. */
export function pushoverFromEnv(env: { PUSHOVER_APP_TOKEN?: string; PUSHOVER_USER_KEY?: string; PUSHOVER_URL: string }): PushoverClient | null {
  return env.PUSHOVER_APP_TOKEN && env.PUSHOVER_USER_KEY
    ? new PushoverClient({ token: env.PUSHOVER_APP_TOKEN, user: env.PUSHOVER_USER_KEY, baseUrl: env.PUSHOVER_URL })
    : null;
}
