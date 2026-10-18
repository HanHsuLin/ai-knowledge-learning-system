import pg from "pg";
import { config, assertDatabaseConfig } from "../config.js";

assertDatabaseConfig();

const { Pool } = pg;

function needsTls(connectionString) {
  try {
    const hostname = new URL(connectionString).hostname;
    return !["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return config.nodeEnv === "production";
  }
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: needsTls(config.databaseUrl) ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on("error", (error) => {
  console.error("PostgreSQL 連線池發生未預期錯誤：", error);
});

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
