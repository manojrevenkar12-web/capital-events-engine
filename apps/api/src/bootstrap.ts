import "reflect-metadata";
import helmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { httpDuration } from "./http/metrics.js";

/** Build the application (used by main, the tests and the OpenAPI generator). */
export const createApp = async (opts: { logger?: boolean } = {}): Promise<NestFastifyApplication> => {
  const adapter = new FastifyAdapter({ bodyLimit: 5 * 1024 * 1024, trustProxy: true });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: opts.logger === false ? false : ["error", "warn", "log"],
  });
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addContentTypeParser(["application/xml", "text/xml"], { parseAs: "string" }, (_req, body, done) => done(null, body));
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
