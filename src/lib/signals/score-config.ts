import type { Role } from "@/lib/sec/roles";

/** All score weights (PLAN section 8). Thresholds for value are in dollars, for increase in percent. */
export const SCORE = {
  role: {
    CEO: 3, CFO: 3, COO: 2, PRESIDENT: 2, OTHER_OFFICER: 2, DIRECTOR: 1, HOLDER_10PCT: 0, OTHER: 0,
  } satisfies Record<Role, number>,
  valueTiers: [
    { min: "1000000", points: 3 },
    { min: "500000", points: 2 },
    { min: "100000", points: 1 },
  ],
  pctTiers: [
    { min: "25", points: 2 },
    { min: "10", points: 1 },
  ],
  newPosition: 2,
  firstBuy: 2,
  cluster: 3,
  heldDirectly: 1,
  heldViaFunds: 0,
  late: -1,
  planSuspected: -2,
} as const;
