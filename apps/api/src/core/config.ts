/**
 * Typed, validated configuration. Every environment variable the API reads is declared
 * here and nowhere else, so docs/guides/configuration.md can be checked against it.
 *
 * Outside production the security-critical values fall back to development defaults
 * so `make up` works with zero setup. In production `assertProductionConfig` refuses
 * to boot while any of them is still a committed default.
 *
 * Three groups are not read from the parsed `config` object, and why:
 *   - RATE_LIMITS, RATE_LIMIT_STORE: read live through `rateLimitEnv()` so a test can
 *     switch limits on for one case; the schema below still validates them.
 *   - DATABASE_URL, DATABASE_SECRET_ARN, DB_*: also read by db/connection-config.ts,
 *     which the migration runner imports without this module.
 *   - MIGRATIONS_DIR: read only by db/migrate.ts (outside the API); declared here so the
 *     list of variables stays complete.
 */
import crypto from "node:crypto";
import { z } from "zod";

export const DEV_DEFAULTS = {
  JWT_SECRET: "change-me-open-conversation-local-access-token-secret",
  REFRESH_SECRET: "change-me-open-conversation-local-refresh-token-secret",
  // 32 bytes, base64, derived from a public constant: fine for a laptop, refused in production.
  TOTP_ENCRYPTION_KEY: crypto.createHash("sha256").update("change-me-open-conversation-local-totp-encryption-key").digest("base64"),
} as const;

/** A base64 string that decodes to exactly 32 bytes (an AES-256 key). */
const key32 = z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64 encoded (openssl rand -base64 32)");

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5046),
  PRODUCT_NAME: z.string().default("Euron Open Conversation"),
  /** The web app origin; emailed links and CORS default to it. */
  APP_WEB_URL: z.string().url().default("http://localhost:3550"),
  /** The public origin the browser reaches this API on (the OpenAI SDP relay URL in live session grants is built from it). */
  PUBLIC_API_URL: z.string().url().default("http://localhost:5046"),
  CORS_ORIGINS: list,
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  /** Local and CI. On AWS leave it unset: the API reads the RDS-managed secret instead (db/connection-config.ts). */
  DATABASE_URL: z.string().optional(),
  DATABASE_SECRET_ARN: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_SSL: z.enum(["disable", "require", "verify-full"]).optional(),
  DB_SSL_CA_FILE: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  MIGRATE_ON_BOOT: bool,

  REDIS_URL: z.string().default("redis://localhost:6449"),
  /** inline: run job handlers in-process after commit (tests, tiny installs). queue: BullMQ. */
  JOBS_MODE: z.enum(["queue", "inline"]).default("queue"),

  JWT_SECRET: z.string().default(DEV_DEFAULTS.JWT_SECRET),
  REFRESH_SECRET: z.string().default(DEV_DEFAULTS.REFRESH_SECRET),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Set to false only for plain-http local development. */
  COOKIE_SECURE: z
    .enum(["true", "false", "auto"])
    .default("auto")
    .transform((v) => v),
  /** bcrypt cost. 12 in production; the test suite lowers it to keep thousands of sign-ups fast. */
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  REQUIRE_EMAIL_VERIFICATION: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** Encrypts TOTP secrets at rest and keys the recovery-code HMAC. Required in production. */
  TOTP_ENCRYPTION_KEY: key32.default(DEV_DEFAULTS.TOTP_ENCRYPTION_KEY),
  /** off disables every rate limit (default off under NODE_ENV=test). Read live: see rateLimitEnv(). */
  RATE_LIMITS: z.string().optional(),
  /** Under NODE_ENV=test limits use memory unless this is "redis". Read live: see rateLimitEnv(). */
  RATE_LIMIT_STORE: z.string().optional(),

  /** Where the mail outbox lives when MAIL_MODE=outbox (default ./data). */
  DATA_DIR: z.string().optional(),
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ENDPOINT_URL: z.string().optional(),

  MAIL_MODE: z.enum(["outbox", "smtp", "ses"]).default("outbox"),
  MAIL_FROM: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SES_REGION: z.string().optional(),
  SES_CONFIGURATION_SET: z.string().optional(),

  /**
   * Model provider API keys, by provider slug: a JSON object such as
   * {"openai":"sk-...","anthropic":"sk-ant-...","openrouter":"sk-or-..."}. On AWS it comes
   * from the Secrets Manager secret `provider-keys`. Keys never enter the database, a log
   * line or an API response (ADR 0004). The single-key variables below are shortcuts for
   * the providers of the same slug; PROVIDER_KEYS wins when both name one.
   */
  PROVIDER_KEYS: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  /** Where providers of kind STUB live (the deterministic fakes in apps/stubs). */
  STUBS_URL: z.string().default("http://localhost:5139"),
  /** OpenAI's REST base for minting realtime client secrets (the stubs in tests). */
  OPENAI_REALTIME_URL: z.string().default("https://api.openai.com/v1"),
  /** Gemini's REST base for minting Live API ephemeral tokens (v1alpha). */
  GEMINI_LIVE_URL: z.string().default("https://generativelanguage.googleapis.com/v1alpha"),
  /** Seconds a minted realtime credential may be used to open a connection. */
  REALTIME_CONNECT_TTL_SECONDS: z.coerce.number().int().min(30).max(600).default(120),
  /** Seconds after a session's max length before the sweeper expires it (the browser vanished). */
  REALTIME_GRACE_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
  /** Largest resume accepted, in megabytes. Resumes are read in memory and never stored. */
  MAX_RESUME_MB: z.coerce.number().int().min(1).max(20).default(8),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  /** demo:seed only: the password every demo account gets (random and printed when unset). */
  DEMO_PASSWORD: z.string().optional(),
  /** db/migrate.ts only: where the .sql files live (default db/migrations next to the runner). */
  MIGRATIONS_DIR: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

export const config: Config = loadConfig();

export const isProd = config.NODE_ENV === "production";
export const isTest = config.NODE_ENV === "test";

/** The two rate-limit switches, read from the environment on every call (tests flip them). */
export function rateLimitEnv(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; store: "memory" | "redis" } {
  const parsed = schema.pick({ RATE_LIMITS: true, RATE_LIMIT_STORE: true }).parse({ RATE_LIMITS: env.RATE_LIMITS, RATE_LIMIT_STORE: env.RATE_LIMIT_STORE });
  return {
    enabled: (parsed.RATE_LIMITS ?? (isTest ? "off" : "on")) !== "off",
    store: isTest && parsed.RATE_LIMIT_STORE !== "redis" ? "memory" : "redis",
  };
}

/** Origins allowed to call the API with credentials. */
export function allowedOrigins(c: Config = config): string[] {
  return c.CORS_ORIGINS.length ? c.CORS_ORIGINS : [c.APP_WEB_URL];
}

export function cookieSecure(c: Config = config): boolean {
  if (c.COOKIE_SECURE === "auto") return c.APP_WEB_URL.startsWith("https://");
  return c.COOKIE_SECURE === "true";
}

/**
 * Production guard. Returns the problems; throws in production so a misconfigured
 * deployment fails at boot instead of on the first request.
 */
export function assertProductionConfig(c: Config = config): string[] {
  const problems: string[] = [];
  const secrets: ["JWT_SECRET" | "REFRESH_SECRET", string][] = [
    ["JWT_SECRET", c.JWT_SECRET],
    ["REFRESH_SECRET", c.REFRESH_SECRET],
  ];
  for (const [key, value] of secrets) {
    if (value === DEV_DEFAULTS[key]) problems.push(`${key} is still the committed development default`);
    else if (value.length < 32) problems.push(`${key} must be at least 32 characters`);
  }
  if (c.JWT_SECRET === c.REFRESH_SECRET) problems.push("JWT_SECRET and REFRESH_SECRET must differ");
  if (c.TOTP_ENCRYPTION_KEY === DEV_DEFAULTS.TOTP_ENCRYPTION_KEY) problems.push("TOTP_ENCRYPTION_KEY is not set (the development default is derived from a public constant)");
  if (!c.CORS_ORIGINS.length) problems.push("CORS_ORIGINS is not set");
  if (/localhost|127\.0\.0\.1/.test(c.APP_WEB_URL)) problems.push("APP_WEB_URL points at localhost");
  if (c.MAIL_MODE === "outbox") problems.push("MAIL_MODE=outbox writes mail to disk instead of sending it");
  if (c.MAIL_MODE !== "outbox" && !c.MAIL_FROM) problems.push("MAIL_FROM is not set");
  if (c.JOBS_MODE === "inline") problems.push("JOBS_MODE=inline runs background work on the request path");
  if (c.BCRYPT_ROUNDS < 12) problems.push("BCRYPT_ROUNDS below 12 weakens stored passwords");
  if (c.NODE_ENV === "production" && problems.length) {
    throw new Error(`Refusing to start with an insecure configuration:\n  - ${problems.join("\n  - ")}`);
  }
  return problems;
}

/**
 * Things worth fixing that must not stop a deployment: the app runs (and an admin can
 * sign in to fix it) before any provider key is set.
 */
export function productionWarnings(c: Config = config): string[] {
  const warnings: string[] = [];
  if (!Object.keys(providerKeys(c)).length) warnings.push("no model provider key is configured (PROVIDER_KEYS or OPENAI_API_KEY, GEMINI_API_KEY, ...): interviews cannot be planned or held");
  return warnings;
}

const SHORTCUTS = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
} as const satisfies Record<string, keyof Config>;

/**
 * Every configured provider key by slug. Placeholders ("set-me", empty) are dropped. A
 * malformed PROVIDER_KEYS is ignored with nothing echoed (it holds secrets).
 */
export function providerKeys(c: Config = config): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [slug, name] of Object.entries(SHORTCUTS)) {
    const v = c[name];
    if (isRealKey(v)) out[slug] = v.trim();
  }
  if (c.PROVIDER_KEYS?.trim()) {
    try {
      const parsed = JSON.parse(c.PROVIDER_KEYS) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [slug, v] of Object.entries(parsed)) if (typeof v === "string" && isRealKey(v)) out[slug] = v.trim();
      }
    } catch {
      // Deliberately silent about the content.
    }
  }
  return out;
}

/** The key for one provider slug, or null. */
export function providerKey(slug: string, c: Config = config): string | null {
  return providerKeys(c)[slug] ?? null;
}

/** Set, and not the Terraform placeholder "set-me". */
export function isRealKey(v: string | undefined): v is string {
  const k = v?.trim();
  return !!k && k !== "set-me";
}
