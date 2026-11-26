import Link from "next/link";

const LINKS = [
  ["/", "Signals"],
  ["/watchlist", "Watchlist"],
  ["/rules", "Rules"],
  ["/status", "Status"],
] as const;

export function Nav() {
  return (
    <nav className="flex items-center gap-4 border-b border-border px-6 py-2 text-sm">
      <span className="font-semibold">SignalPrism</span>
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className="text-muted-foreground hover:text-foreground">
          {label}
        </Link>
      ))}
    </nav>
  );
}
