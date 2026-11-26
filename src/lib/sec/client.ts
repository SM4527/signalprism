import { RateLimiter, sleep } from "./limiter.ts";

const HOUR_MS = 3_600_000;
const MAX_TRIES = 5;
const MAX_RETRY_AFTER_MS = 300_000;
const PAUSE_AFTER_403 = 3;

/** Three consecutive 403 responses: stop all SEC traffic until `until` (epoch ms). */
export class SecPaused extends Error {
  until: number;

  constructor(until: number) {
    super(`SEC paused until ${new Date(until).toISOString()}`);
    this.until = until;
  }
}

export class SecHttpError extends Error {
  status: number;

  constructor(status: number) {
    super(`SEC responded ${status}`);
    this.status = status;
  }
}

export interface SecClientOptions {
  userAgent: string;
  limiter?: RateLimiter;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

/** The one door to SEC: User-Agent, shared 8 req/s limiter, backoff on 429/503, pause after 403s. */
export class SecClient {
  /** Requests sent so far, retries included. */
  requests = 0;
  private consecutive403 = 0;
  private limiter: RateLimiter;
  private now: () => number;
  private wait: (ms: number) => Promise<void>;
  private userAgent: string;

  constructor(o: SecClientOptions) {
    this.userAgent = o.userAgent;
    this.now = o.now ?? Date.now;
    this.wait = o.wait ?? sleep;
    this.limiter = o.limiter ?? new RateLimiter(8, this.now, this.wait);
  }

  /** GET a URL as text. Throws SecPaused on the third consecutive 403, SecHttpError on any other failure. */
  async get(url: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire();
      this.requests++;
      const res = await fetch(url, { headers: { "User-Agent": this.userAgent } });
      this.consecutive403 = res.status === 403 ? this.consecutive403 + 1 : 0;
      if (res.ok) return res.text();
      if (res.status === 403 && this.consecutive403 >= PAUSE_AFTER_403) {
        this.consecutive403 = 0;
        throw new SecPaused(this.now() + HOUR_MS);
      }
      const retryable = res.status === 429 || res.status === 503;
      if (!retryable || attempt + 1 >= MAX_TRIES) throw new SecHttpError(res.status);
      await this.wait(this.delayMs(res, attempt));
    }
  }

  private delayMs(res: Response, attempt: number): number {
    const seconds = Number(res.headers.get("retry-after"));
    if (res.headers.get("retry-after") && Number.isFinite(seconds)) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }
    return 1000 * 2 ** attempt;
  }
}
