import { logger } from "@devforge/logger";
import Fastify from "fastify";

import { registerErrorHandler } from "./http/errors/index.js";
import { healthRoutes } from "./http/routes/health.js";

export function createApp() {
  const app: ReturnType<typeof Fastify> = Fastify({
    loggerInstance: logger,
  });

  app.register(healthRoutes);
  registerErrorHandler(app);

  return app;
}