import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../db.js";

const migrationPath = join(process.cwd(), "migrations", "001_init.sql");
const sql = await readFile(migrationPath, "utf8");
await pool.query(sql);
await pool.end();
console.log("Migration complete");

