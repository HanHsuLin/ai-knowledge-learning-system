import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/pool.js";

const server = app.listen(config.port, () => {
  console.log(`後端已啟動：http://localhost:${config.port}`);
  console.log(`健康檢查：http://localhost:${config.port}/api/health`);
});

async function shutdown(signal) {
  console.log(`收到 ${signal}，正在關閉後端…`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
