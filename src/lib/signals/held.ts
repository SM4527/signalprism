import type Database from "better-sqlite3";

/**
 * Set `in_portfolio` and `held_via` on every signal of one issuer from the company's current flags
 * (direct wins over funds). It reflects holdings now, so older signals show today's holdings.
 */
export function syncHeldVia(db: Database.Database, issuerCik: string): void {
  const c = db.prepare("SELECT in_direct, in_funds FROM company WHERE cik = ?").get(issuerCik) as
    | { in_direct: number; in_funds: number }
    | undefined;
  const heldVia = c?.in_direct ? "direct" : c?.in_funds ? "funds" : null;
  db.prepare("UPDATE signal SET in_portfolio = ?, held_via = ? WHERE issuer_cik = ?").run(+(heldVia !== null), heldVia, issuerCik);
}
