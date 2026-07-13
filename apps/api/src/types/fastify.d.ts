import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
    log: FastifyRequest["log"] & { child: (obj: { requestId: string }) => FastifyRequest["log"] };
  }
}