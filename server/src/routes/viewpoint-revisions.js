import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../db/pool.js";
import {
  generateRevisedViewpoint,
  generateRevisionQuestion
} from "../services/gemini.js";

const router = Router({ mergeParams: true });
const idSchema = z.string().uuid();
const messageSchema = z.object({ content: z.string().trim().min(1).max(20_000) });

async function revisionContext(recordId) {
  const result = await pool.query(
    `SELECT r.id,
       COALESCE(string_agg(DISTINCT NULLIF(CONCAT_WS(E'\n', m.raw_text, m.extracted_text), ''), E'\n\n'), '') AS material,
       v.id AS viewpoint_id, v.content AS viewpoint
     FROM records r
     LEFT JOIN materials m ON m.record_id = r.id
     LEFT JOIN LATERAL (
       SELECT id, content
       FROM viewpoints
       WHERE record_id = r.id AND status IN ('draft', 'confirmed')
       ORDER BY CASE status WHEN 'draft' THEN 0 ELSE 1 END, version DESC
       LIMIT 1
     ) v ON true
     WHERE r.id = $1
     GROUP BY r.id, v.id, v.content`,
    [recordId]
  );
  if (!result.rowCount) return null;

  const messages = await pool.query(
    `SELECT id, role, content, metadata, created_at AS "createdAt"
     FROM messages
     WHERE record_id = $1 AND channel = 'viewpoint_revision'
     ORDER BY created_at, id`,
    [recordId]
  );
  return { ...result.rows[0], messages: messages.rows };
}

router.get("/", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const context = await revisionContext(recordId);
  if (!context) return response.status(404).json({ error: "找不到學習紀錄" });
  response.json({ data: context.messages });
});

router.post("/", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const input = messageSchema.parse(request.body);
  const context = await revisionContext(recordId);
  if (!context) return response.status(404).json({ error: "找不到學習紀錄" });
  if (!context.viewpoint_id) {
    return response.status(409).json({ error: "尚未產生可修改的觀點" });
  }

  const lastAssistant = [...context.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const startsNewRevision = !lastAssistant || lastAssistant.metadata?.phase === "revised";
  const userResult = await pool.query(
    `INSERT INTO messages (record_id, channel, role, content, metadata)
     VALUES ($1, 'viewpoint_revision', 'user', $2, $3::jsonb)
     RETURNING id, role, content, metadata, created_at AS "createdAt"`,
    [recordId, input.content, JSON.stringify({ phase: startsNewRevision ? "request" : "clarification" })]
  );

  if (startsNewRevision) {
    const question = await generateRevisionQuestion({
      material: context.material,
      viewpoint: context.viewpoint,
      learnerRequest: input.content
    });
    const assistant = await pool.query(
      `INSERT INTO messages (record_id, channel, role, content, metadata)
       VALUES ($1, 'viewpoint_revision', 'assistant', $2, $3::jsonb)
       RETURNING id, role, content, metadata, created_at AS "createdAt"`,
      [recordId, question, JSON.stringify({ phase: "clarifying", updatedViewpoint: false })]
    );
    return response.status(201).json({
      data: { user: userResult.rows[0], assistant: assistant.rows[0], updatedViewpoint: null }
    });
  }

  const discussion = [...context.messages, userResult.rows[0]];
  const revisedContent = await generateRevisedViewpoint({
    material: context.material,
    viewpoint: context.viewpoint,
    revisionMessages: discussion
  });

  const result = await withTransaction(async (client) => {
    await client.query(
      "UPDATE viewpoints SET status = 'superseded' WHERE record_id = $1 AND status = 'draft'",
      [recordId]
    );
    const viewpoint = await client.query(
      `INSERT INTO viewpoints (record_id, version, content, source_message_count)
       SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3
       FROM viewpoints WHERE record_id = $1
       RETURNING id, version, content, status,
         source_message_count AS "sourceMessageCount", created_at AS "createdAt"`,
      [recordId, revisedContent, discussion.length]
    );
    const assistant = await client.query(
      `INSERT INTO messages (record_id, channel, role, content, metadata)
       VALUES ($1, 'viewpoint_revision', 'assistant', $2, $3::jsonb)
       RETURNING id, role, content, metadata, created_at AS "createdAt"`,
      [
        recordId,
        "我已依照剛才確認的修改方向產生新版觀點，請查看上方內容後再決定是否確認。",
        JSON.stringify({ phase: "revised", updatedViewpoint: true, viewpointId: viewpoint.rows[0].id })
      ]
    );
    await client.query(
      "UPDATE records SET stage = GREATEST(stage, 3), confirmed = false, updated_at = now() WHERE id = $1",
      [recordId]
    );
    return { assistant: assistant.rows[0], viewpoint: viewpoint.rows[0] };
  });

  response.status(201).json({
    data: {
      user: userResult.rows[0],
      assistant: result.assistant,
      updatedViewpoint: result.viewpoint
    }
  });
});

export default router;
