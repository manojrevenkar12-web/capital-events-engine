/**
 * Bearer-token authentication and role checks. Tokens carry the tenant (tid), roles and, for
 * investor users, the investor id. HS256 with a shared secret in development; RS256 from a JWKS
 * URL in production.
 */
import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { z } from "zod";
import { forbidden } from "../common/errors.js";
import { type AppConfig, CONFIG } from "../config/config.js";
import type { Principal, Role } from "./principal.js";

const ROLES = "roles";
const PUBLIC = "public";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
export const Public = () => SetMetadata(PUBLIC, true);

export const CurrentUser = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): Principal => ctx.switchToHttp().getRequest<{ principal: Principal }>().principal,
);

const Claims = z.object({
  sub: z.string(),
  name: z.string().default(""),
  tid: z.string(),
  roles: z.array(z.enum(["preparer", "approver", "viewer", "investor", "admin"])),
  inv: z.string().optional(),
});

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly secret: Uint8Array;
  private readonly jwks?: JWTVerifyGetKey;

  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.secret = new TextEncoder().encode(config.JWT_SECRET);
    if (config.JWKS_URL) this.jwks = createRemoteJWKSet(new URL(config.JWKS_URL));
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; principal?: Principal }>();
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (!token) throw new UnauthorizedException("missing bearer token");
    let payload: unknown;
    try {
      const opts = { issuer: this.config.JWT_ISSUER, audience: "cee-api" };
      payload = (this.jwks ? await jwtVerify(token, this.jwks, opts) : await jwtVerify(token, this.secret, opts)).payload;
    } catch {
      throw new UnauthorizedException("invalid token");
    }
    const c = Claims.safeParse(payload);
    if (!c.success) throw new UnauthorizedException("token is missing required claims");
    const principal: Principal = {
      sub: c.data.sub,
      name: c.data.name || c.data.sub,
      tenantId: c.data.tid,
      roles: c.data.roles,
      ...(c.data.inv ? { investorId: c.data.inv } : {}),
    };
    req.principal = principal;
    const need = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (need && !need.some((r) => principal.roles.includes(r) || principal.roles.includes("admin"))) {
      throw forbidden("ROLE_REQUIRED", `requires one of: ${need.join(", ")}`);
    }
    return true;
  }
}
