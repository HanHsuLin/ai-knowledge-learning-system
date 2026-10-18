import multer from "multer";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { extractAndStorePdf, removeStoredFile } from "../services/pdf.js";

const router = Router({ mergeParams: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: config.maxPdfBytes },
  fileFilter: (_request, file, done) => {
    if (file.mimetype !== "application/pdf") {
      const error = new Error("只接受 PDF 檔案");
      error.statusCode = 400;
      return done(error);
    }
    done(null, true);
  }
});

const textMaterialSchema = z.object({
  text: z.string().trim().min(1).max(2_000_000)
});

async function ensureRecord(recordId) {
  const result = await pool.query("SELECT id FROM records WHERE id = $1", [recordId]);
  if (!result.rowCount) {
    const error = new Error("找不到學習紀錄");
    error.statusCode = 404;
    throw error;
  }
}

router.get("/", async (request, response) => {
  await ensureRecord(request.params.recordId);
  const result = await pool.query(
    `SELECT id, input_type AS "inputType", original_name AS "fileName",
       mime_type AS "mimeType", raw_text AS "rawText",
       extracted_text AS "extractedText", processing_status AS "processingStatus",
       processing_error AS "processingError", created_at AS "createdAt"
     FROM materials WHERE record_id = $1 ORDER BY created_at`,
    [request.params.recordId]
  );
  response.json({ data: result.rows });
});

router.post("/text", async (request, response) => {
  const input = textMaterialSchema.parse(request.body);
  await ensureRecord(request.params.recordId);
  const result = await pool.query(
    `INSERT INTO materials (record_id, input_type, raw_text)
     VALUES ($1, 'text', $2)
     RETURNING id, input_type AS "inputType", raw_text AS "rawText",
       processing_status AS "processingStatus", created_at AS "createdAt"`,
    [request.params.recordId, input.text]
  );
  response.status(201).json({ data: result.rows[0] });
});

router.post("/pdf", upload.single("pdf"), async (request, response) => {
  if (!request.file) {
    return response.status(400).json({ error: "請選擇 PDF 檔案" });
  }

  await ensureRecord(request.params.recordId);
  const stored = await extractAndStorePdf(request.file.buffer);
  try {
    const result = await pool.query(
      `INSERT INTO materials (
         record_id, input_type, original_name, mime_type, storage_path,
         extracted_text, processing_status, sha256
       ) VALUES ($1, 'pdf', $2, $3, $4, $5, 'ready', $6)
       RETURNING id, input_type AS "inputType", original_name AS "fileName",
         mime_type AS "mimeType", extracted_text AS "extractedText",
         processing_status AS "processingStatus", created_at AS "createdAt"`,
      [
        request.params.recordId,
        request.file.originalname,
        request.file.mimetype,
        stored.storagePath,
        stored.extractedText,
        stored.sha256
      ]
    );
    response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    await removeStoredFile(stored.absolutePath);
    throw error;
  }
});

export default router;
