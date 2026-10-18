import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../db/pool.js";
import {
  generateIntegrationReply,
  generateIntegrationRevisionQuestion,
  generateIntegrationSummary,
  generateRevisedIntegration
} from "../services/gemini.js";

const router = Router({ mergeParams: true });
const idSchema = z.string().uuid();
const relationTypes = [
  "causal",
  "contradictory",
  "complementary",
  "supporting",
  "revision",
  "conditional"
];

const createSchema = z.object({
  relatedRecordId: z.string().uuid()
});

const updateSchema = z.object({
  comparisonAnswer: z.string().max(100_000).optional(),
  challenge: z.string().max(100_000).optional(),
  challengeAnswer: z.string().max(100_000).optional(),
  content: z.string().max(100_000).optional(),
  relationType: z.enum(relationTypes).nullable().optional()
}).refine((value) => Object.keys(value).length > 0, "至少需要一個更新欄位");

const integrationSelect = `
  SELECT id,
    record_id AS "recordId",
    related_record_id AS "relatedRecordId",
    status,
    comparison_answer AS "comparisonAnswer",
    challenge,
    challenge_answer AS "challengeAnswer",
    content,
    relation_type AS "relationType",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    confirmed_at AS "confirmedAt"
  FROM integrations
`;

const messageSchema = z.object({ content: z.string().trim().min(1).max(20_000) });

async function integrationContext(recordId, integrationId, channel) {
  const result = await pool.query(
    `SELECT i.id, i.content, i.related_record_id AS "relatedRecordId",
       source_viewpoint.content AS "sourceViewpoint",
       target_viewpoint.content AS "targetViewpoint"
     FROM integrations i
     JOIN LATERAL (
       SELECT content FROM viewpoints
       WHERE record_id = i.record_id AND status = 'confirmed'
       ORDER BY version DESC LIMIT 1
     ) source_viewpoint ON true
     JOIN LATERAL (
       SELECT content FROM viewpoints
       WHERE record_id = i.related_record_id AND status = 'confirmed'
       ORDER BY version DESC LIMIT 1
     ) target_viewpoint ON true
     WHERE i.id = $1 AND i.record_id = $2`,
    [integrationId, recordId]
  );
  if (!result.rowCount) return null;

  const messages = await pool.query(
    `SELECT id, role, content, metadata, created_at AS "createdAt"
     FROM messages
     WHERE record_id = $1 AND channel = $2
       AND metadata->>'integrationId' = $3
     ORDER BY created_at, id`,
    [recordId, channel, integrationId]
  );
  return { ...result.rows[0], messages: messages.rows };
}

router.get("/", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const result = await pool.query(
    `${integrationSelect} WHERE record_id = $1 ORDER BY updated_at DESC`,
    [recordId]
  );
  response.json({ data: result.rows });
});

router.post("/", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const input = createSchema.parse(request.body);
  if (recordId === input.relatedRecordId) {
    return response.status(400).json({ error: "不能將紀錄連結到自己" });
  }

  const records = await pool.query(
    `SELECT id FROM records
     WHERE id = ANY($1::uuid[]) AND confirmed = true`,
    [[recordId, input.relatedRecordId]]
  );
  if (records.rowCount !== 2) {
    return response.status(409).json({ error: "兩筆紀錄都必須已確認觀點" });
  }

  const result = await pool.query(
    `INSERT INTO integrations (record_id, related_record_id)
     VALUES ($1, $2)
     RETURNING id, record_id AS "recordId", related_record_id AS "relatedRecordId",
       status, comparison_answer AS "comparisonAnswer", challenge,
       challenge_answer AS "challengeAnswer", content,
       relation_type AS "relationType", created_at AS "createdAt",
       updated_at AS "updatedAt", confirmed_at AS "confirmedAt"`,
    [recordId, input.relatedRecordId]
  );
  response.status(201).json({ data: result.rows[0] });
});

router.patch("/:integrationId", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const integrationId = idSchema.parse(request.params.integrationId);
  const input = updateSchema.parse(request.body);
  const columns = {
    comparisonAnswer: "comparison_answer",
    challenge: "challenge",
    challengeAnswer: "challenge_answer",
    content: "content",
    relationType: "relation_type"
  };
  const entries = Object.entries(input);
  const assignments = entries.map(([key], index) => `${columns[key]} = $${index + 1}`);
  const values = entries.map(([, value]) => value);
  values.push(integrationId, recordId);
  const result = await pool.query(
    `UPDATE integrations
     SET ${assignments.join(", ")}, status = 'draft', updated_at = now()
     WHERE id = $${values.length - 1} AND record_id = $${values.length} AND status <> 'confirmed'
     RETURNING id, record_id AS "recordId", related_record_id AS "relatedRecordId",
       status, comparison_answer AS "comparisonAnswer", challenge,
       challenge_answer AS "challengeAnswer", content,
       relation_type AS "relationType", created_at AS "createdAt",
       updated_at AS "updatedAt", confirmed_at AS "confirmedAt"`,
    values
  );
  if (!result.rowCount) return response.status(404).json({ error: "找不到可修改的整合草稿" });
  response.json({ data: result.rows[0] });
});

router.get("/:integrationId/discussion", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const integrationId = idSchema.parse(request.params.integrationId);
  const context = await integrationContext(recordId, integrationId, "integration_comparison");
  if (!context) return response.status(404).json({ error: "找不到整合紀錄" });
  response.json({ data: context.messages });
});

router.post("/:integrationId/discussion", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const integrationId = idSchema.parse(request.params.integrationId);
  const input = messageSchema.parse(request.body);
  const context = await integrationContext(recordId, integrationId, "integration_comparison");
  if (!context) return response.status(404).json({ error: "找不到整合紀錄" });

  const metadata = JSON.stringify({ integrationId });
  const user = await pool.query(
    `INSERT INTO messages (record_id, channel, role, content, metadata)
     VALUES ($1, 'integration_comparison', 'user', $2, $3::jsonb)
     RETURNING id, role, content, metadata, created_at AS "createdAt"`,
    [recordId, input.content, metadata]
  );
  const reply = await generateIntegrationReply({
    sourceViewpoint: context.sourceViewpoint,
    targetViewpoint: context.targetViewpoint,
    messages: context.messages,
    learnerText: input.content
  });
  const assistant = await pool.query(
    `INSERT INTO messages (record_id, channel, role, content, metadata)
     VALUES ($1, 'integration_comparison', 'assistant', $2, $3::jsonb)
     RETURNING id, role, content, metadata, created_at AS "createdAt"`,
    [recordId, reply, metadata]
  );
  response.status(201).json({ data: { user: user.rows[0], assistant: assistant.rows[0] } });
});

router.post("/:integrationId/generate", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const integrationId = idSchema.parse(request.params.integrationId);
  const context = await integrationContext(recordId, integrationId, "integration_comparison");
  if (!context) return response.status(404).json({ error: "找不到整合紀錄" });
  if (!context.messages.some((message) => message.role === "user")) {
    return response.status(409).json({ error: "學習者至少需要回答一次，才能整理跨來源觀點" });
  }
  const content = await generateIntegrationSummary(context);
  const result = await pool.query(
    `UPDATE integrations SET content = $1, status = 'draft', updated_at = now()
     WHERE id = $2 AND record_id = $3 AND status <> 'confirmed'
     RETURNING id, content, status, relation_type AS "relationType", updated_at AS "updatedAt"`,
    [content, integrationId, recordId]
  );
  if (!result.rowCount) return response.status(409).json({ error: "已確認的整合觀點不可重新產生" });
  response.json({ data: result.rows[0] });
});

router.get("/:integrationId/revisions", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const integrationId = idSchema.parse(request.params.integrationId);
  const context = await integrationContext(recordId, integrationId, "integration_revision");
  if (!context) return response.status(404).json({ error: "找不到整合紀錄" });
  response.json({ data: context.messages });
});

router.post("/:integrationId/revisions", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const integrationId = idSchema.parse(request.params.integrationId);
  const input = messageSchema.parse(request.body);
  const context = await integrationContext(recordId, integrationId, "integration_revision");
  if (!context) return response.status(404).json({ error: "找不到整合紀錄" });
  if (!context.content.trim()) {
    return response.status(409).json({ error: "尚未產生可修改的跨來源整合觀點" });
  }

  const lastAssistant = [...context.messages].reverse().find((message) => message.role === "assistant");
  const startsNewRevision = !lastAssistant || lastAssistant.metadata?.phase === "revised";
  const userMetadata = JSON.stringify({
    integrationId,
    phase: startsNewRevision ? "request" : "clarification"
  });
  const user = await pool.query(
    `INSERT INTO messages (record_id, channel, role, content, metadata)
     VALUES ($1, 'integration_revision', 'user', $2, $3::jsonb)
     RETURNING id, role, content, metadata, created_at AS "createdAt"`,
    [recordId, input.content, userMetadata]
  );

  if (startsNewRevision) {
    const question = await generateIntegrationRevisionQuestion({
      sourceViewpoint: context.sourceViewpoint,
      targetViewpoint: context.targetViewpoint,
      integration: context.content,
      learnerRequest: input.content
    });
    const assistant = await pool.query(
      `INSERT INTO messages (record_id, channel, role, content, metadata)
       VALUES ($1, 'integration_revision', 'assistant', $2, $3::jsonb)
       RETURNING id, role, content, metadata, created_at AS "createdAt"`,
      [recordId, question, JSON.stringify({ integrationId, phase: "clarifying", updatedIntegration: false })]
    );
    return response.status(201).json({
      data: { user: user.rows[0], assistant: assistant.rows[0], updatedIntegration: null }
    });
  }

  const discussion = [...context.messages, user.rows[0]];
  const revisedContent = await generateRevisedIntegration({
    sourceViewpoint: context.sourceViewpoint,
    targetViewpoint: context.targetViewpoint,
    integration: context.content,
    revisionMessages: discussion
  });
  const result = await withTransaction(async (client) => {
    const integration = await client.query(
      `UPDATE integrations SET content = $1, status = 'draft', updated_at = now()
       WHERE id = $2 AND record_id = $3 AND status <> 'confirmed'
       RETURNING id, content, status, relation_type AS "relationType", updated_at AS "updatedAt"`,
      [revisedContent, integrationId, recordId]
    );
    if (!integration.rowCount) {
      const error = new Error("已確認的整合觀點不可修改");
      error.statusCode = 409;
      throw error;
    }
    const assistant = await client.query(
      `INSERT INTO messages (record_id, channel, role, content, metadata)
       VALUES ($1, 'integration_revision', 'assistant', $2, $3::jsonb)
       RETURNING id, role, content, metadata, created_at AS "createdAt"`,
      [
        recordId,
        "我已依照剛才確認的方向更新跨來源整合觀點，請查看後再決定是否確認。",
        JSON.stringify({ integrationId, phase: "revised", updatedIntegration: true })
      ]
    );
    return { integration: integration.rows[0], assistant: assistant.rows[0] };
  });
  response.status(201).json({
    data: { user: user.rows[0], assistant: result.assistant, updatedIntegration: result.integration }
  });
});

router.post("/:integrationId/confirm", async (request, response) => {
  const recordId = idSchema.parse(request.params.recordId);
  const integrationId = idSchema.parse(request.params.integrationId);
  const integration = await withTransaction(async (client) => {
    const found = await client.query(
      `SELECT id, record_id, related_record_id, content, relation_type
       FROM integrations
       WHERE id = $1 AND record_id = $2
       FOR UPDATE`,
      [integrationId, recordId]
    );
    if (!found.rowCount) return null;
    const draft = found.rows[0];
    if (!draft.content.trim() || !draft.relation_type) {
      const error = new Error("確認前必須填寫整合內容並選擇知識關係");
      error.statusCode = 409;
      throw error;
    }

    const directional = ["causal", "revision", "conditional"].includes(draft.relation_type);
    if (!directional) {
      await client.query(
        `DELETE FROM knowledge_links
         WHERE relation_type = $3
           AND ((source_record_id = $1 AND target_record_id = $2)
             OR (source_record_id = $2 AND target_record_id = $1))`,
        [draft.record_id, draft.related_record_id, draft.relation_type]
      );
    }
    await client.query(
      `INSERT INTO knowledge_links (
         source_record_id, target_record_id, integration_id, relation_type, is_directional
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_record_id, target_record_id, relation_type)
       DO UPDATE SET integration_id = EXCLUDED.integration_id,
         is_directional = EXCLUDED.is_directional, confirmed_at = now()`,
      [draft.record_id, draft.related_record_id, integrationId, draft.relation_type, directional]
    );
    const confirmed = await client.query(
      `UPDATE integrations
       SET status = 'confirmed', confirmed_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING id, record_id AS "recordId", related_record_id AS "relatedRecordId",
         status, comparison_answer AS "comparisonAnswer", challenge,
         challenge_answer AS "challengeAnswer", content,
         relation_type AS "relationType", created_at AS "createdAt",
         updated_at AS "updatedAt", confirmed_at AS "confirmedAt"`,
      [integrationId]
    );
    await client.query(
      "UPDATE records SET stage = 4, updated_at = now() WHERE id = $1",
      [recordId]
    );
    return confirmed.rows[0];
  });
  if (!integration) return response.status(404).json({ error: "找不到整合紀錄" });
  response.json({ data: integration });
});

export default router;
