import { Badge } from "@/components/badge";
import type { CompanyRow } from "@/lib/queries/companies";

export function SourceChips({ c }: { c: CompanyRow }) {
  return (
    <span className="flex gap-1">
      {c.inDirect && <Badge tone="info">direct</Badge>}
      {c.inFunds && <Badge tone="info">funds</Badge>}
      {c.inManual && <Badge tone="muted">manual</Badge>}
    </span>
  );
}
