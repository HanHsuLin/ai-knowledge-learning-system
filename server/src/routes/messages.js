import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../db/pool.js";
import { generateTutorReply } from "../services/gemini.js";

const router = Router({ mergeParams: true });
const idSchema = z.string().uuid();
const messageSchema = z.object({
  content: z.string().trim().min(1).max(20_000)
});

async function learningContext(recordId) {
  const recordResult = await pool.query(
    `SELECT r.id, r.title,
       COALESCE(string_agg(NULLIF(CONCAT_WS(E'\n', m.raw_text, m.extracted_text), ''), E'\n\n'
         ORDER BY m.created_at), '') AS material
     FROM records r
     LEFT JOIN materials m ON m.record_id = r.id
     WHERE r.id = $1
     GROUP BY r.id`,
    [recordId]
  );
  if (!recordResult.rowCount) return null;

  const messagesResult = await pool.query(
    `SELECT id, role, content, metadata, created_at AS "createdAt"
     FROM messages
     WHERE record_id = $1 AND channel = 'learning'
     ORDER BY created_at, id`,
    [recordId]
  );
  return { ...recordResult.rows[0], messages: messagesResult.rows };
}

router.get("/", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const context = await learningContext(recordId);
  if (!context) return response.status(404).json({ error: "找不到學習紀錄" });
  response.json({ data: context.messages });
});

router.post("/", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const input = messageSchema.parse(request.body);
  const context = await learningContext(recordId);
  if (!context) return response.status(404).json({ error: "找不到學習紀錄" });
  if (!context.material.trim()) {
    return response.status(409).json({ error: "這筆紀錄尚無可供 AI 參考的學習材料" });
  }

  const reply = await generateTutorReply({
    material: context.material,
    messages: context.messages,
    learnerText: input.content
  });

  const saved = await withTransaction(async (client) => {
    const userResult = await client.query(
      `INSERT INTO messages (record_id, channel, role, content)
       VALUES ($1, 'learning', 'user', $2)
       RETURNING id, role, content, metadata, created_at AS "createdAt"`,
      [recordId, input.content]
    );
    const assistantResult = await client.query(
      `INSERT INTO messages (record_id, channel, role, content, metadata)
       VALUES ($1, 'learning', 'assistant', $2, $3::jsonb)
       RETURNING id, role, content, metadata, created_at AS "createdAt"`,
      [recordId, reply, JSON.stringify({ model: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite" })]
    );
    await client.query(
      "UPDATE records SET stage = GREATEST(stage, 2), updated_at = now() WHERE id = $1",
      [recordId]
    );
    return { user: userResult.rows[0], assistant: assistantResult.rows[0] };
  });

  response.status(201).json({
    data: saved
  });
});

export default router;
