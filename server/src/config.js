import "dotenv/config";

const numberFromEnv = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  port: numberFromEnv(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://127.0.0.1:5500",
  maxPdfBytes: numberFromEnv(process.env.MAX_PDF_BYTES, 15 * 1024 * 1024)
});

export function assertDatabaseConfig() {
  if (!config.databaseUrl) {
    throw new Error("缺少 DATABASE_URL，請依照 .env.example 建立 .env。");
  }
}
