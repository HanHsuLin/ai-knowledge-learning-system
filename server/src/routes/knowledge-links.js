import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";

const router = Router({ mergeParams: true });
const idSchema = z.string().uuid();

router.get("/related", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const current = await pool.query(
    `SELECT v.content
     FROM viewpoints v
     WHERE v.record_id = $1 AND v.status = 'confirmed'
     ORDER BY v.version DESC LIMIT 1`,
    [recordId]
  );
  if (!current.rowCount) {
    return response.status(409).json({ error: "目前紀錄尚未確認觀點" });
  }

  const result = await pool.query(
    `SELECT r.id, r.title, v.content AS viewpoint,
       GREATEST(
         similarity(v.content, $2),
         word_similarity(LEFT($2, 2000), LEFT(v.content, 2000))
       ) AS score
     FROM records r
     JOIN LATERAL (
       SELECT content
       FROM viewpoints
       WHERE record_id = r.id AND status = 'confirmed'
       ORDER BY version DESC LIMIT 1
     ) v ON true
     WHERE r.id <> $1
     ORDER BY score DESC, r.updated_at DESC
     LIMIT 5`,
    [recordId, current.rows[0].content]
  );
  response.json({ data: result.rows });
});

router.get("/links", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const result = await pool.query(
    `SELECT kl.id,
       kl.source_record_id AS "sourceRecordId",
       source.title AS "sourceTitle",
       kl.target_record_id AS "targetRecordId",
       target.title AS "targetTitle",
       kl.relation_type AS "relationType",
       kl.is_directional AS "isDirectional",
       kl.confirmed_at AS "confirmedAt"
     FROM knowledge_links kl
     JOIN records source ON source.id = kl.source_record_id
     JOIN records target ON target.id = kl.target_record_id
     WHERE kl.source_record_id = $1 OR kl.target_record_id = $1
     ORDER BY kl.confirmed_at DESC`,
    [recordId]
  );
  response.json({ data: result.rows });
});

export default router;
