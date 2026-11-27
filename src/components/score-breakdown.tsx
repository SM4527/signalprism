import { scoreText, type ScorePart } from "@/lib/signals/score";

export function ScoreBreakdown({ score, parts }: { score: number; parts: ScorePart[] }) {
  return (
    <span data-testid="score-breakdown" className="text-xs text-muted-foreground">
      {scoreText(score, parts)}
    </span>
  );
}
