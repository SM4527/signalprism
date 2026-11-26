import Decimal from "decimal.js";
import type { Role } from "@/lib/sec/roles";
import { SCORE } from "./score-config";

export interface ScoreInput {
  role: Role;
  value: string;
  pctIncrease: string | null;
  newPosition: boolean;
  late: boolean;
  planSuspected: boolean;
  heldVia: "direct" | "funds" | null;
  inCluster: boolean;
  firstBuy: boolean;
}

export interface ScorePart {
  label: string;
  points: number;
}

export interface Score {
  score: number;
  parts: ScorePart[];
}

const dollars = (v: string) =>
  new Decimal(v).gte(1_000_000) ? `$${new Decimal(v).div(1_000_000).toDecimalPlaces(1)}M`
  : new Decimal(v).gte(1_000) ? `$${new Decimal(v).div(1_000).toDecimalPlaces(0)}K`
  : `$${v}`;

/** Deterministic score with its breakdown. */
export function scoreSignal(s: ScoreInput): Score {
  const parts: ScorePart[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) parts.push({ label, points });
  };

  add(s.role, SCORE.role[s.role]);
  const tier = SCORE.valueTiers.find((t) => new Decimal(s.value).gte(t.min));
  if (tier) add(dollars(s.value), tier.points);
  if (s.newPosition) add("new position", SCORE.newPosition);
  else {
    const pct = SCORE.pctTiers.find((t) => s.pctIncrease !== null && new Decimal(s.pctIncrease).gte(t.min));
    if (pct) add(`+${new Decimal(s.pctIncrease!).toDecimalPlaces(1)}% holdings`, pct.points);
  }
  if (s.firstBuy) add("first buy in 12 months", SCORE.firstBuy);
  if (s.inCluster) add("cluster", SCORE.cluster);
  if (s.heldVia === "direct") add("held directly", SCORE.heldDirectly);
  if (s.heldVia === "funds") add("held via funds", SCORE.heldViaFunds);
  if (s.late) add("filed late", SCORE.late);
  if (s.planSuspected) add("10b5-1 suspected", SCORE.planSuspected);

  return { score: parts.reduce((n, p) => n + p.points, 0), parts };
}
