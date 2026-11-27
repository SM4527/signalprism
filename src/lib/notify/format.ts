import { formatIncrease, formatShares, formatUsd } from "@/lib/format";
import type { Role } from "@/lib/sec/roles";
import { scoreText, type ScorePart } from "@/lib/signals/score";

/** Pushover limits. */
export const LIMITS = { title: 250, message: 1024, url: 512 } as const;

export type PortfolioHint = "off" | "flag" | "detail";

/** What is stored in `payload_json` and sent: nothing else, never a token or key. Priority is 0 or 1, never 2. */
export interface Alert {
  title: string;
  body: string;
  url: string | null;
  priority: 0 | 1;
}

/** Scores at or above this are high priority. */
export const HIGH_PRIORITY_SCORE = 10;

export const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

const ROLE_LABEL: Record<Role, string> = {
  CEO: "CEO",
  CFO: "CFO",
  COO: "COO",
  PRESIDENT: "President",
  OTHER_OFFICER: "Officer",
  DIRECTOR: "Director",
  HOLDER_10PCT: "10% owner",
  OTHER: "Insider",
};

export interface SignalAlertInput {
  ticker: string | null;
  issuerName: string | null;
  /** All owners of a joint group, individuals first. */
  owners: string[];
  role: Role;
  titleRaw: string | null;
  shares: string;
  avgPrice: string;
  value: string;
  pctIncrease: string | null;
  newPosition: boolean;
  txnDate: string;
  filedAt: string;
  score: number;
  parts: ScorePart[];
  heldVia: "direct" | "funds" | null;
  /** Short flags such as Indirect, Amended, 10b5-1 suspected, Cluster. */
  badges: string[];
  url: string;
}

const heldText = (v: "direct" | "funds") => (v === "direct" ? "Held directly" : "Held via funds");

/** `ACME · CEO buy · $1.2M · +38.2%`, with a star after the ticker when the hint is `flag` and the stock is held. */
export function formatSignalAlert(s: SignalAlertInput, hint: PortfolioHint): Alert {
  const name = s.ticker ?? s.issuerName ?? "Unknown";
  const star = hint === "flag" && s.heldVia ? " ★" : "";
  const increase = formatIncrease(s.pctIncrease, s.newPosition);
  const title = [`${name}${star}`, `${ROLE_LABEL[s.role]} buy`, formatUsd(s.value), increase === "—" ? null : increase]
    .filter(Boolean)
    .join(" · ");

  const who = `${s.owners.join(", ")}${s.titleRaw ? ` (${s.titleRaw})` : ""}`;
  const lines = [
    who,
    `${formatShares(s.shares)} sh at $${s.avgPrice} = ${formatUsd(s.value)}`,
    `Bought ${s.txnDate}, filed ${s.filedAt}`,
    s.badges.length ? s.badges.join(", ") : null,
    scoreText(s.score, s.parts),
    hint === "detail" && s.heldVia ? heldText(s.heldVia) : null,
  ];
  return {
    title: clip(title, LIMITS.title),
    body: clip(lines.filter(Boolean).join("\n"), LIMITS.message),
    url: clip(s.url, LIMITS.url),
    priority: s.score >= HIGH_PRIORITY_SCORE ? 1 : 0,
  };
}

export interface ClusterAlertInput {
  ticker: string | null;
  issuerName: string | null;
  insiderCount: number;
  totalValue: string;
  windowStart: string;
  windowEnd: string;
  members: { owners: string[]; role: Role; value: string }[];
  heldVia: "direct" | "funds" | null;
  url: string;
}

/** `ACME · Cluster buy · 3 insiders · $480K`. High priority. */
export function formatClusterAlert(c: ClusterAlertInput, hint: PortfolioHint): Alert {
  const name = c.ticker ?? c.issuerName ?? "Unknown";
  const star = hint === "flag" && c.heldVia ? " ★" : "";
  const title = `${name}${star} · Cluster buy · ${c.insiderCount} insiders · ${formatUsd(c.totalValue)}`;
  const lines = [
    `${c.windowStart} to ${c.windowEnd}`,
    ...c.members.map((m) => `${m.owners.join(", ")} (${ROLE_LABEL[m.role]}) ${formatUsd(m.value)}`),
    hint === "detail" && c.heldVia ? heldText(c.heldVia) : null,
  ];
  return {
    title: clip(title, LIMITS.title),
    body: clip(lines.filter(Boolean).join("\n"), LIMITS.message),
    url: clip(c.url, LIMITS.url),
    priority: 1,
  };
}

/** One summary of held alerts: their titles, cut so the message fits with a "+N more" line. */
export function formatDigest(titles: string[]): Alert {
  const kept: string[] = [];
  let size = 0;
  for (const [i, t] of titles.entries()) {
    // Leave room for the "+N more" line unless this is the last title.
    const budget = i === titles.length - 1 ? LIMITS.message : LIMITS.message - 20;
    if (size + t.length + 1 > budget) break;
    kept.push(t);
    size += t.length + 1;
  }
  const rest = titles.length - kept.length;
  const body = [...kept, rest > 0 ? `+${rest} more` : null].filter(Boolean).join("\n");
  return {
    title: clip(`SignalPrism digest · ${titles.length} alert${titles.length === 1 ? "" : "s"}`, LIMITS.title),
    body: clip(body, LIMITS.message),
    url: null,
    priority: 0,
  };
}
