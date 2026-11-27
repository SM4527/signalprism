import Link from "next/link";

const LINKS = [
  ["/", "Signals"],
  ["/watchlist", "Watchlist"],
  ["/rules", "Rules"],
  ["/status", "Status"],
] as const;

export function Nav({ mode }: { mode: "mock" | "live" }) {
  return (
    <nav className="flex items-center gap-4 border-b border-border px-6 py-2 text-sm">
      <span className="font-semibold">SignalPrism</span>
      {mode === "live" && (
        <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-xs font-medium text-blue-400">
          Personal
        </span>
      )}
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className="text-muted-foreground hover:text-foreground">
          {label}
        </Link>
      ))}
    </nav>
  );
}
