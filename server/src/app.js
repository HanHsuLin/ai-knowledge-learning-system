import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import recordsRouter from "./routes/records.js";
import messagesRouter from "./routes/messages.js";
import viewpointsRouter from "./routes/viewpoints.js";
import viewpointRevisionsRouter from "./routes/viewpoint-revisions.js";
import integrationsRouter from "./routes/integrations.js";
import knowledgeLinksRouter from "./routes/knowledge-links.js";
import materialsRouter from "./routes/materials.js";
import { geminiStatus } from "./services/gemini.js";
import multer from "multer";

export const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: [config.frontendOrigin, "http://localhost:5500"],
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "2mb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8" }));

app.get("/api/health", async (_request, response) => {
  const database = await pool.query("SELECT now() AS now");
  response.json({
    status: "ok",
    database: { connected: true, time: database.rows[0].now },
    gemini: geminiStatus()
  });
});

app.use("/api/records", recordsRouter);
app.use("/api/records/:recordId/materials", materialsRouter);
app.use("/api/records/:recordId/messages", messagesRouter);
app.use("/api/records/:recordId/viewpoints", viewpointsRouter);
app.use("/api/records/:recordId/viewpoint-revisions", viewpointRevisionsRouter);
app.use("/api/records/:recordId/integrations", integrationsRouter);
app.use("/api/records/:recordId/knowledge", knowledgeLinksRouter);

app.use((_request, response) => {
  response.status(404).json({ error: "找不到 API 路徑" });
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "PDF 檔案超過允許的大小"
      : "PDF 上傳失敗";
    return response.status(status).json({ error: message, code: error.code });
  }
  if (error instanceof ZodError) {
    return response.status(400).json({
      error: "輸入資料格式錯誤",
      details: error.issues
    });
  }
  console.error(error);
  response.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : "伺服器發生錯誤"
  });
});
