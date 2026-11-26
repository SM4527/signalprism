import type { SignalListRow } from "@/lib/queries/signals";

const TONE = {
  good: "bg-emerald-500/15 text-emerald-300",
  warn: "bg-amber-500/15 text-amber-300",
  info: "bg-sky-500/15 text-sky-300",
  muted: "bg-muted text-muted-foreground",
} as const;

export function Badge({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 ${TONE[tone]}`}>{children}</span>;
}

/** All badges of one signal: Cluster, New position, Late, Indirect, Non-common, and the rest. */
export function SignalBadges({ s }: { s: SignalListRow }) {
  return (
    <span className="flex flex-wrap gap-1">
      {s.inCluster && <Badge tone="good">Cluster</Badge>}
      {s.newPosition && <Badge tone="good">New position</Badge>}
      {s.heldVia === "direct" && <Badge tone="info">Held directly</Badge>}
      {s.heldVia === "funds" && <Badge tone="info">Via funds</Badge>}
      {s.late && <Badge tone="warn">Late</Badge>}
      {s.indirect && <Badge tone="muted">Indirect</Badge>}
      {s.nonCommon && <Badge tone="muted">Non-common</Badge>}
      {s.plan10b51 && <Badge tone="warn">10b5-1 plan</Badge>}
      {s.planSuspected &&<Badge tone="warn">10b5-1 suspected</Badge>}
      {s.formType === "4/A" && <Badge tone="muted">Amended</Badge>}
    </span>
  );
}
