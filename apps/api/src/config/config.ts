/** Configuration from the environment, validated once at start-up. */
import { z } from "zod";

const Schema = z
  .object({
    DATABASE_URL: z.string().default("mysql://cee:cee@127.0.0.1:3306/cee"),
    PORT: z.coerce.number().int().default(3000),
    /** HS256 secret for the local identity provider. Production verifies your identity provider's keys (JWKS_URL). */
    JWT_SECRET: z.string().min(32).optional(),
    JWT_ISSUER: z.string().default("https://id.cee.local"),
    JWKS_URL: z.string().url().optional(),
    DEV_TOKENS: z
      .enum(["on", "off"])
      .default("off")
      .transform((v) => v === "on"),
    /** Approvals from distinct approvers a capital event needs before it can be issued. */
    REQUIRED_APPROVALS: z.coerce.number().int().min(1).default(1),
    /** rules (deterministic) or claude (Anthropic API) side-letter extraction. */
    EXTRACTOR: z.enum(["rules", "claude"]).default("rules"),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
    OUTBOX_POLL_MS: z.coerce.number().int().default(500),
    LOG_LEVEL: z.string().default("info"),
  })
  .superRefine((c, ctx) => {
    // There is no default secret: a deployment that sets neither would accept tokens anyone can sign.
    if (!c.JWKS_URL && !c.JWT_SECRET)
      ctx.addIssue({
        code: "custom",
        path: ["JWT_SECRET"],
        message: "set JWKS_URL (your identity provider) or, for local use, a JWT_SECRET of 32+ characters",
      });
    if (c.DEV_TOKENS && !c.JWT_SECRET)
      ctx.addIssue({ code: "custom", path: ["JWT_SECRET"], message: "DEV_TOKENS=on signs tokens with JWT_SECRET; set it" });
  });

export type AppConfig = z.infer<typeof Schema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => Schema.parse(env);

export const CONFIG = Symbol("CONFIG");
