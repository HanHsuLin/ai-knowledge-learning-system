import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../db/pool.js";

const router = Router();

const createRecordSchema = z.object({
  title: z.string().trim().min(1).max(200),
  rawText: z.string().trim().max(2_000_000).default("")
});

const updateRecordSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  stage: z.number().int().min(1).max(4).optional(),
  confirmed: z.boolean().optional(),
  knowledgeLinksSkipped: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, "至少需要一個更新欄位");

const recordSelect = `
  SELECT
    r.id,
    r.title,
    r.stage,
    r.confirmed,
    r.knowledge_links_skipped AS "knowledgeLinksSkipped",
    r.created_at AS "createdAt",
    r.updated_at AS "updatedAt",
    COALESCE(m.raw_text, '') AS "rawText",
    COALESCE(m.extracted_text, '') AS "extractedText",
    m.original_name AS "fileName"
  FROM records r
  LEFT JOIN LATERAL (
    SELECT * FROM materials
    WHERE record_id = r.id
    ORDER BY created_at DESC
    LIMIT 1
  ) m ON true
`;

router.get("/", async (_request, response) => {
  const result = await pool.query(`${recordSelect} ORDER BY r.updated_at DESC`);
  response.json({ data: result.rows });
});

router.get("/:id", async (request, response) => {
  const result = await pool.query(`${recordSelect} WHERE r.id = $1`, [request.params.id]);
  if (!result.rowCount) return response.status(404).json({ error: "找不到學習紀錄" });
  response.json({ data: result.rows[0] });
});

router.post("/", async (request, response) => {
  const input = createRecordSchema.parse(request.body);
  const record = await withTransaction(async (client) => {
    const created = await client.query(
      `INSERT INTO records (title, stage)
       VALUES ($1, 2)
       RETURNING id, title, stage, confirmed,
         knowledge_links_skipped AS "knowledgeLinksSkipped",
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [input.title]
    );
    if (input.rawText) {
      await client.query(
        `INSERT INTO materials (record_id, input_type, raw_text)
         VALUES ($1, 'text', $2)`,
        [created.rows[0].id, input.rawText]
      );
    }
    await client.query(
      `INSERT INTO messages (record_id, channel, role, content)
       VALUES ($1, 'learning', 'assistant', $2)`,
      [created.rows[0].id, "你認為這份材料最重要的主張是什麼？請先用自己的話說明。"]
    );
    return { ...created.rows[0], rawText: input.rawText };
  });
  response.status(201).json({ data: record });
});

router.patch("/:id", async (request, response) => {
  const input = updateRecordSchema.parse(request.body);
  const columns = {
    title: "title",
    stage: "stage",
    confirmed: "confirmed",
    knowledgeLinksSkipped: "knowledge_links_skipped"
  };
  const entries = Object.entries(input);
  const assignments = entries.map(([key], index) => `${columns[key]} = $${index + 1}`);
  const values = entries.map(([, value]) => value);
  values.push(request.params.id);
  const result = await pool.query(
    `UPDATE records
     SET ${assignments.join(", ")}, updated_at = now()
     WHERE id = $${values.length}
     RETURNING id, title, stage, confirmed,
       knowledge_links_skipped AS "knowledgeLinksSkipped",
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    values
  );
  if (!result.rowCount) return response.status(404).json({ error: "找不到學習紀錄" });
  response.json({ data: result.rows[0] });
});

router.delete("/:id", async (request, response) => {
  const result = await pool.query("DELETE FROM records WHERE id = $1 RETURNING id", [request.params.id]);
  if (!result.rowCount) return response.status(404).json({ error: "找不到學習紀錄" });
  response.status(204).end();
});

export default router;
