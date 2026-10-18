import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const uploadDirectory = path.join(projectRoot, "uploads");

export async function extractAndStorePdf(buffer) {
  if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    const error = new Error("檔案內容不是有效的 PDF");
    error.statusCode = 400;
    throw error;
  }

  const parser = new PDFParse({ data: buffer });
  let extractedText = "";
  try {
    const result = await parser.getText();
    extractedText = result.text.trim();
  } catch (cause) {
    const error = new Error("無法讀取這份 PDF 的文字內容");
    error.statusCode = 422;
    error.cause = cause;
    throw error;
  } finally {
    await parser.destroy();
  }

  await mkdir(uploadDirectory, { recursive: true });
  const storedName = `${randomUUID()}.pdf`;
  const absolutePath = path.join(uploadDirectory, storedName);
  await writeFile(absolutePath, buffer, { flag: "wx" });

  return {
    extractedText,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    storagePath: path.posix.join("uploads", storedName),
    absolutePath
  };
}

export async function removeStoredFile(absolutePath) {
  if (!absolutePath) return;
  await unlink(absolutePath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
