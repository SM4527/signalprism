import type { ScorePart } from "@/lib/signals/score";

const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** `Score 9: CEO +3, $1.2M +3, first buy in 12 months +2, held directly +1`. */
export function scoreText(score: number, parts: ScorePart[]): string {
  return `Score ${score}: ${parts.map((p) => `${p.label} ${sign(p.points)}`).join(", ")}`;
}

export function ScoreBreakdown({ score, parts }: { score: number; parts: ScorePart[] }) {
  return (
    <span data-testid="score-breakdown" className="text-xs text-muted-foreground">
      {scoreText(score, parts)}
    </span>
  );
}
