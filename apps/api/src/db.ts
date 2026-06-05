import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000
});

export type DbClient = pg.PoolClient;

export async function withTransaction<T>(
  isolationLevel: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE",
  fn: (client: DbClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`begin isolation level ${isolationLevel}`);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

