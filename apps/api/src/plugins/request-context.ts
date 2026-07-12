import { logger } from "@repo/logger";
import { FastifyPluginAsync, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";

const REQUEST_ID_HEADER = "x-request-id";
const RESPONSE_ID_HEADER = "x-request-id";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveRequestId(req: FastifyRequest): string {
  const inbound = req.headers[REQUEST_ID_HEADER];

  if (typeof inbound === "string" && UUID_REGEX.test(inbound)) {
    return inbound;
  }

  if (Array.isArray(inbound)) {
    for (const value of inbound) {
      if (typeof value === "string" && UUID_REGEX.test(value)) {
        return value;
      }
    }
  }

  return randomUUID();
}

const requestContextPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (request, reply) => {
    const requestId = resolveRequestId(request);

    request.requestId = requestId;
    request.log = logger.child({ requestId });

    reply.header(RESPONSE_ID_HEADER, requestId);
  });
};

export default requestContextPlugin;
