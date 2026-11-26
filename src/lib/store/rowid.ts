/** better-sqlite3 returns `lastInsertRowid` as a number unless bigint mode is on; ids are not money. */
export const toId = (id: number | bigint): number => id as number;
