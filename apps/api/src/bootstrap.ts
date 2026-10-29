import "reflect-metadata";
import { randomUUID } from "node:crypto";
import helmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import { httpDuration } from "./http/metrics.js";

/** Build the application (used by main, the tests and the OpenAPI generator). */
export const createApp = async (opts: { logger?: boolean } = {}): Promise<NestFastifyApplication> => {
  // The caller's x-request-id (from the ingress) becomes the request id in every log line and is echoed back.
  const adapter = new FastifyAdapter({
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: true,
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });
  if (opts.logger === false) process.env.LOG_LEVEL ??= "silent";
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: opts.logger !== false,
    logger: opts.logger === false ? false : undefined,
  });
  if (opts.logger !== false) app.useLogger(app.get(Logger));
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addContentTypeParser(["application/xml", "text/xml"], { parseAs: "string" }, (_req, body, done) => done(null, body));
  fastify.addHook("onSend", (req, reply, _payload, done) => {
    reply.header("x-request-id", req.id);
    done();
  });
  fastify.addHook("onResponse", (req, reply, done) => {
    httpDuration.observe(
      { method: req.method, route: req.routeOptions?.url ?? "unmatched", status: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
    done();
  });
  await app.register(helmet as never, { contentSecurityPolicy: false });
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(",") ?? false });
  app.enableShutdownHooks();
  return app;
};
