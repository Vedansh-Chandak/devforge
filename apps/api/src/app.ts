import Fastify from "fastify";
import { healthRoutes } from "./http/routes/health.js";

export function createApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(healthRoutes);

  return app;
}