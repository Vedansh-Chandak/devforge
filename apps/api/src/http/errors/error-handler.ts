import { env } from "@devforge/config";
import { logger } from "@devforge/logger";
import {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { ZodError } from "zod";

import { AppError } from "./app-error.js";

const isDevelopment = env.NODE_ENV === "development";

interface ErrorBody {
  code: string;
  message: string;
  details: unknown;
  stack?: string;
}

interface ErrorResponse {
  error: ErrorBody;
  requestId: string;
}

function buildResponseBody(
  response: ErrorBody,
  requestId: string
): ErrorResponse {
  const errorBody: ErrorBody = isDevelopment
    ? response
    : {
        code: response.code,
        message: response.message,
        details: response.details,
      };

  return {
    error: errorBody,
    requestId,
  };
}

function handleZodError(error: ZodError): AppError {
  return new AppError({
    statusCode: 400,
    code: "VALIDATION_ERROR",
    message: "Request validation failed",
    details: error.issues,
  });
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (
      error: FastifyError,
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      const requestId = request.id ?? "unknown";

      if (error instanceof AppError) {
        logger.warn(
          {
            err: error,
            code: error.code,
            statusCode: error.statusCode,
            requestId,
          },
          "request failed"
        );

        return reply.status(error.statusCode).send(
          buildResponseBody(
            {
              code: error.code,
              message: error.message,
              details: error.details,
              ...(isDevelopment ? { stack: error.stack } : {}),
            },
            requestId
          )
        );
      }

      if (error instanceof ZodError) {
        const appError = handleZodError(error);

        logger.warn(
          {
            err: error,
            code: appError.code,
            statusCode: appError.statusCode,
            requestId,
          },
          "request validation failed"
        );

        return reply.status(appError.statusCode).send(
          buildResponseBody(
            {
              code: appError.code,
              message: appError.message,
              details: appError.details,
              ...(isDevelopment ? { stack: error.stack } : {}),
            },
            requestId
          )
        );
      }

      const fastifyStatus = error.statusCode ?? 500;

      if (fastifyStatus >= 400 && fastifyStatus < 500) {
        logger.warn(
          { err: error, statusCode: fastifyStatus, requestId },
          "client error"
        );

        return reply.status(fastifyStatus).send(
          buildResponseBody(
            {
              code: error.code ?? "CLIENT_ERROR",
              message: error.message ?? "Client error",
              details: null,
              ...(isDevelopment ? { stack: error.stack } : {}),
            },
            requestId
          )
        );
      }

      logger.error({ err: error, requestId }, "unhandled error");

      return reply.status(500).send(
        buildResponseBody(
          {
            code: "INTERNAL_ERROR",
            message: isDevelopment
              ? error.message || "Internal server error"
              : "Internal server error",
            details: null,
            ...(isDevelopment ? { stack: error.stack } : {}),
          },
          requestId
        )
      );
    }
  );
}
