import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(currentDirectory, "../../migrations");
const initialSchemaTables = [
  "records",
  "materials",
  "messages",
  "viewpoints",
  "integrations",
  "knowledge_links"
];

async function baselineInitialSchemaIfPresent() {
  const result = await pool.query(
    `SELECT relname
       FROM pg_class
      WHERE relkind = 'r'
        AND relnamespace = 'public'::regnamespace
        AND relname = ANY($1::text[])`,
    [initialSchemaTables]
  );

  if (result.rowCount !== initialSchemaTables.length) return;

  await pool.query(
    `INSERT INTO schema_migrations (filename)
     VALUES ('001_initial_schema.sql')
     ON CONFLICT (filename) DO NOTHING`
  );
  console.log("已辨識並登記既有的初始資料表。");
}

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await baselineInitialSchemaIfPresent();

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    const exists = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [filename]
    );
    if (exists.rowCount) continue;

    const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [filename]
      );
      await client.query("COMMIT");
      console.log(`已套用 migration：${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  console.log("資料庫 migration 已完成。");
} finally {
  await pool.end();
}
