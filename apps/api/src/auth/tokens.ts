import { SignJWT } from "jose";
import type { Role } from "./principal.js";

/** Issue a token as the dev identity provider would (tests, seed, local console). */
export const issueToken = async (
  secret: string,
  issuer: string,
  claims: { sub: string; name?: string; tid: string; roles: Role[]; inv?: string },
  ttl = "8h",
): Promise<string> =>
  new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer)
    .setAudience("cee-api")
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(new TextEncoder().encode(secret));
