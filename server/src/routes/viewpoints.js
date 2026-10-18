import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../db/pool.js";
import { generateViewpointSummary } from "../services/gemini.js";

const router = Router({ mergeParams: true });
const idSchema = z.string().uuid();
const updateSchema = z.object({ content: z.string().trim().min(1).max(100_000) });

router.get("/", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const result = await pool.query(
    `SELECT id, version, content, status,
       source_message_count AS "sourceMessageCount",
       created_at AS "createdAt", confirmed_at AS "confirmedAt"
     FROM viewpoints
     WHERE record_id = $1
     ORDER BY version DESC`,
    [recordId]
  );
  response.json({ data: result.rows });
});

router.post("/generate", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const recordResult = await pool.query(
    `SELECT r.id,
       COALESCE(string_agg(NULLIF(CONCAT_WS(E'\n', m.raw_text, m.extracted_text), ''), E'\n\n'
         ORDER BY m.created_at), '') AS material
     FROM records r
     LEFT JOIN materials m ON m.record_id = r.id
     WHERE r.id = $1
     GROUP BY r.id`,
    [recordId]
  );
  if (!recordResult.rowCount) return response.status(404).json({ error: "找不到學習紀錄" });

  const messagesResult = await pool.query(
    `SELECT role, content
     FROM messages
     WHERE record_id = $1 AND channel = 'learning'
     ORDER BY created_at, id`,
    [recordId]
  );
  const hasLearnerMessage = messagesResult.rows.some((message) => message.role === "user");
  if (!hasLearnerMessage) {
    return response.status(409).json({ error: "學習者至少需要回答一次，才能整理觀點" });
  }

  const content = await generateViewpointSummary({
    material: recordResult.rows[0].material,
    messages: messagesResult.rows
  });

  const viewpoint = await withTransaction(async (client) => {
    await client.query(
      "UPDATE viewpoints SET status = 'superseded' WHERE record_id = $1 AND status = 'draft'",
      [recordId]
    );
    const result = await client.query(
      `INSERT INTO viewpoints (record_id, version, content, source_message_count)
       SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3
       FROM viewpoints
       WHERE record_id = $1
       RETURNING id, version, content, status,
         source_message_count AS "sourceMessageCount",
         created_at AS "createdAt"`,
      [recordId, content, messagesResult.rowCount]
    );
    await client.query(
      "UPDATE records SET stage = GREATEST(stage, 3), confirmed = false, updated_at = now() WHERE id = $1",
      [recordId]
    );
    return result.rows[0];
  });

  response.status(201).json({ data: viewpoint });
});

router.patch("/:viewpointId", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const viewpointId = idSchema.parse(request.params.viewpointId);
  const input = updateSchema.parse(request.body);
  const result = await pool.query(
    `UPDATE viewpoints
     SET content = $1
     WHERE id = $2 AND record_id = $3 AND status = 'draft'
     RETURNING id, version, content, status,
       source_message_count AS "sourceMessageCount",
       created_at AS "createdAt"`,
    [input.content, viewpointId, recordId]
  );
  if (!result.rowCount) {
    return response.status(404).json({ error: "找不到可修改的觀點草稿" });
  }
  response.json({ data: result.rows[0] });
});

router.post("/:viewpointId/confirm", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const viewpointId = idSchema.parse(request.params.viewpointId);
  const viewpoint = await withTransaction(async (client) => {
    const exists = await client.query(
      "SELECT id FROM viewpoints WHERE id = $1 AND record_id = $2",
      [viewpointId, recordId]
    );
    if (!exists.rowCount) return null;
    await client.query(
      "UPDATE viewpoints SET status = 'superseded' WHERE record_id = $1 AND id <> $2",
      [recordId, viewpointId]
    );
    const result = await client.query(
      `UPDATE viewpoints
       SET status = 'confirmed', confirmed_at = now()
       WHERE id = $1
       RETURNING id, version, content, status,
         source_message_count AS "sourceMessageCount",
         created_at AS "createdAt", confirmed_at AS "confirmedAt"`,
      [viewpointId]
    );
    await client.query(
      "UPDATE records SET confirmed = true, updated_at = now() WHERE id = $1",
      [recordId]
    );
    return result.rows[0];
  });
  if (!viewpoint) return response.status(404).json({ error: "找不到觀點" });
  response.json({ data: viewpoint });
});

export default router;
