/**
 * Domain errors map to RFC 9457 problem details. A domain error carries a stable code that
 * clients and the console switch on; the message is for people.
 */

import { EngineError } from "@cee/engine";
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import { TenancyViolation } from "../db/tenancy.js";

export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = (what: string, id: string) => new DomainError(404, "NOT_FOUND", `${what} ${id} not found`);
export const conflict = (code: string, message: string, detail: Record<string, unknown> = {}) =>
  new DomainError(409, code, message, detail);
export const forbidden = (code: string, message: string) => new DomainError(403, code, message);
export const unprocessable = (code: string, message: string, detail: Record<string, unknown> = {}) =>
  new DomainError(422, code, message, detail);

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const send = (status: number, code: string, title: string, extra: Record<string, unknown> = {}) =>
      reply
        .status(status)
        .header("content-type", "application/problem+json")
        .send({ type: `https://cee.dev/problems/${code.toLowerCase()}`, title, status, code, ...extra });

    if (e instanceof DomainError) return void send(e.status, e.code, e.message, e.detail);
    if (e instanceof EngineError) return void send(422, e.code, e.message, { ids: e.ids });
    if (e instanceof ZodError) {
      return void send(400, "INVALID_REQUEST", "the request does not match the schema", {
        errors: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (e instanceof HttpException) {
      return void send(e.getStatus(), e.name.replace(/Exception$/, "").toUpperCase(), e.message);
    }
    if (e instanceof TenancyViolation) {
      // a programming error that would have crossed tenants: never show details to the caller
      console.error(e);
      return void send(500, "INTERNAL", "internal error");
    }
    console.error(e);
    send(500, "INTERNAL", "internal error");
  }
}
