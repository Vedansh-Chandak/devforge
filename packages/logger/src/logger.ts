import { env } from "@devforge/config";
import pino from "pino";

const isDevelopment = env.NODE_ENV === "development";

function createLogger() {
  return pino({
    level: isDevelopment ? "debug" : "info",
    ...(isDevelopment
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:HH:MM:ss.l",
              ignore: "pid,hostname",
            },
          },
        }
      : {}),
  });
}

export const logger = createLogger();
