import { getDb } from "@/lib/db";
import { seedSample } from "@/lib/seed-sample";
import { seedDefaults } from "@/lib/signals/rules";

/** Seeds the in-memory database the route handlers open (DB_PATH=:memory:) with the sample data. */
export function seedRouteDb() {
  process.env.DB_PATH = ":memory:";
  delete process.env.DATA_MODE;
  const db = getDb(":memory:");
  seedDefaults(db);
  seedSample(db, new Date().toISOString().slice(0, 10));
  return db;
}

export const loopback = { host: "127.0.0.1:8500" };

export const req = (path: string, headers: Record<string, string> = loopback, method = "GET") =>
  new Request(`http://127.0.0.1:8500${path}`, { method, headers });
