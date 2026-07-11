import "dotenv/config";

import { env } from "@devforge/config";

import { createApp } from "./app.js";

async function start() {
  const app = createApp();

  try {
    await app.listen({
      host: env.HOST,
      port: env.PORT,
    });

    app.log.info(
      `🚀 DevForge API is running at http://${env.HOST}:${env.PORT}`
    );
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();