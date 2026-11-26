export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sliding one-second window: at most `perSecond` acquisitions in any 1000 ms. Call from one task at a time. */
export class RateLimiter {
  private stamps: number[] = [];
  private perSecond: number;
  private now: () => number;
  private wait: (ms: number) => Promise<void>;

  constructor(perSecond = 8, now: () => number = Date.now, wait: (ms: number) => Promise<void> = sleep) {
    this.perSecond = perSecond;
    this.now = now;
    this.wait = wait;
  }

  async acquire(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.stamps = this.stamps.filter((s) => t - s < 1000);
      if (this.stamps.length < this.perSecond) {
        this.stamps.push(t);
        return;
      }
      await this.wait(this.stamps[0] + 1000 - t);
    }
  }
}
