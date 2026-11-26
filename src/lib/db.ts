import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

/** Apply numbered `.sql` files that have not run yet, each in a transaction. */
export function migrate(db: Database.Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const done = new Set(
    db.prepare("SELECT name FROM schema_migrations").pluck().all() as string[],
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files.filter((f) => !done.has(f))) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(file, new Date().toISOString());
    })();
  }
}

/** Latest applied migration file name, used as the schema version. */
export function schemaVersion(db: Database.Database): string {
  return db.prepare("SELECT max(name) FROM schema_migrations").pluck().get() as string;
}

const g = globalThis as { __signalprismDb?: Database.Database };

/** Process-wide database, opened once (shared by instrumentation and route handlers). */
export function getDb(path: string): Database.Database {
  return (g.__signalprismDb ??= openDb(path));
}

/** Open the database, set WAL and busy timeout, and run migrations. */
export function openDb(path: string): Database.Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}
