import { Redis } from "ioredis";
import { afterAll, describe, expect, test, vi } from "vitest";
import { assertProductionConfig, DEV_DEFAULTS, isRealKey, loadConfig, productionWarnings, providerKey, providerKeys } from "../../src/core/config";
import { LOCAL_DATABASE_URL, resolveConnectionConfig } from "../../src/db/connection-config";
import { redisLimiter } from "../../src/middleware/rate-limit";
import { decryptTotpSecret, encryptTotpSecret, hashRecoveryCode, newRecoveryCodes } from "../../src/security/totp";

const prodBase = {
  NODE_ENV: "test",
  JWT_SECRET: "a".repeat(40),
  REFRESH_SECRET: "b".repeat(40),
  CORS_ORIGINS: "https://interviews.example.com",
  APP_WEB_URL: "https://interviews.example.com",
  MAIL_MODE: "ses",
  MAIL_FROM: "Interviews <no-reply@example.com>",
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  OPENAI_API_KEY: "sk-prod-example-key-123456",
};

describe("production guard", () => {
  test("a complete production config has no problems and no warnings", () => {
    expect(assertProductionConfig(loadConfig(prodBase))).toEqual([]);
    expect(productionWarnings(loadConfig(prodBase))).toEqual([]);
  });

  test("TOTP_ENCRYPTION_KEY is required: the derived development default is refused; a wrong length does not parse", () => {
    const { TOTP_ENCRYPTION_KEY: _k, ...rest } = prodBase;
    const c = loadConfig(rest);
    expect(c.TOTP_ENCRYPTION_KEY).toBe(DEV_DEFAULTS.TOTP_ENCRYPTION_KEY);
    expect(assertProductionConfig(c).join("\n")).toMatch(/TOTP_ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...prodBase, TOTP_ENCRYPTION_KEY: "c2hvcnQ=" })).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  test("development secrets, short secrets and identical secrets are refused", () => {
    expect(assertProductionConfig(loadConfig({ ...prodBase, JWT_SECRET: DEV_DEFAULTS.JWT_SECRET })).join("\n")).toMatch(/JWT_SECRET is still the committed development default/);
    expect(assertProductionConfig(loadConfig({ ...prodBase, REFRESH_SECRET: "short" })).join("\n")).toMatch(/REFRESH_SECRET must be at least 32/);
    expect(assertProductionConfig(loadConfig({ ...prodBase, REFRESH_SECRET: prodBase.JWT_SECRET })).join("\n")).toMatch(/must differ/);
  });

  test("local shortcuts are refused: inline jobs, outbox mail, weak bcrypt, a localhost web URL, no CORS origins", () => {
    const problems = assertProductionConfig(loadConfig({ ...prodBase, JOBS_MODE: "inline", MAIL_MODE: "outbox", BCRYPT_ROUNDS: "10", APP_WEB_URL: "http://localhost:3550", CORS_ORIGINS: "" })).join("\n");
    for (const re of [/JOBS_MODE=inline/, /MAIL_MODE=outbox/, /BCRYPT_ROUNDS/, /APP_WEB_URL points at localhost/, /CORS_ORIGINS is not set/]) expect(problems).toMatch(re);
  });

  test("a non-outbox mail mode needs MAIL_FROM", () => {
    const { MAIL_FROM: _f, ...noFrom } = prodBase;
    expect(assertProductionConfig(loadConfig(noFrom)).join("\n")).toMatch(/MAIL_FROM is not set/);
  });

  test("NODE_ENV=production throws with the list; the message never contains a key", () => {
    const err = (() => {
      try {
        assertProductionConfig(loadConfig({ ...prodBase, NODE_ENV: "production", JOBS_MODE: "inline" }));
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    expect(err?.message).toMatch(/Refusing to start/);
    expect(err?.message).not.toContain(prodBase.OPENAI_API_KEY);
  });

  test("a missing provider key is a warning, not a boot failure", () => {
    const { OPENAI_API_KEY: _o, ...noKey } = prodBase;
    expect(assertProductionConfig(loadConfig(noKey))).toEqual([]);
    expect(productionWarnings(loadConfig(noKey)).join("\n")).toMatch(/no model provider key/);
    expect(productionWarnings(loadConfig({ ...prodBase, OPENAI_API_KEY: "set-me" })).join("\n")).toMatch(/no model provider key/);
    const { OPENAI_API_KEY: _p, ...geminiOnly } = prodBase;
    expect(productionWarnings(loadConfig({ ...geminiOnly, GEMINI_API_KEY: "gm-key" }))).toEqual([]);
  });

  test("the env vars the API reads outside config.ts are declared in it", () => {
    const c = loadConfig({ RATE_LIMITS: "off", RATE_LIMIT_STORE: "redis", DEMO_PASSWORD: "x", MIGRATIONS_DIR: "/m" });
    expect(c).toMatchObject({ RATE_LIMITS: "off", RATE_LIMIT_STORE: "redis", DEMO_PASSWORD: "x", MIGRATIONS_DIR: "/m" });
  });
});

describe("provider keys", () => {
  test("isRealKey drops empty values and the Terraform placeholder", () => {
    expect(isRealKey(undefined)).toBe(false);
    expect(isRealKey("")).toBe(false);
    expect(isRealKey("   ")).toBe(false);
    expect(isRealKey("set-me")).toBe(false);
    expect(isRealKey(" set-me ")).toBe(false);
    expect(isRealKey("sk-abc")).toBe(true);
  });

  test("shortcut variables map to slugs; PROVIDER_KEYS adds custom slugs and wins on conflict; placeholders are dropped", () => {
    const keys = providerKeys(loadConfig({ OPENAI_API_KEY: " sk-short ", GEMINI_API_KEY: "set-me", PROVIDER_KEYS: JSON.stringify({ openai: "sk-wins", openrouter: "sk-or-1", local: "set-me", bad: 5 }) }));
    expect(keys).toEqual({ openai: "sk-wins", openrouter: "sk-or-1" });
    expect(providerKey("openrouter", loadConfig({ PROVIDER_KEYS: '{"openrouter":"sk-or-2"}' }))).toBe("sk-or-2");
    expect(providerKey("anthropic", loadConfig({}))).toBeNull();
  });

  test("a malformed PROVIDER_KEYS is ignored without echoing its content anywhere", () => {
    const secret = '{"openai": "sk-very-secret-value-0001"';
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const c = loadConfig({ PROVIDER_KEYS: secret, ANTHROPIC_API_KEY: "sk-ant-ok" });
    let thrown: unknown = null;
    let keys: Record<string, string> = {};
    try {
      keys = providerKeys(c);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeNull();
    expect(keys).toEqual({ anthropic: "sk-ant-ok" });
    const said = [...warn.mock.calls, ...err.mock.calls].flat().map(String).join(" ") + productionWarnings(c).join(" ") + assertProductionConfig(c).join(" ");
    expect(said).not.toContain("sk-very-secret-value-0001");
    warn.mockRestore();
    err.mockRestore();
  });

  test("an array PROVIDER_KEYS is ignored too", () => {
    expect(providerKeys(loadConfig({ PROVIDER_KEYS: '["sk-a"]' }))).toEqual({});
  });
});

describe("database connection default", () => {
  test("with nothing set it falls back to the local compose Postgres, nothing else", () => {
    expect(resolveConnectionConfig({})).toEqual({ connectionString: LOCAL_DATABASE_URL });
    expect(LOCAL_DATABASE_URL).toBe("postgres://conv:conv@localhost:5512/conv");
  });
});

describe("TOTP at rest", () => {
  test("ciphertext round-trips only for the same user, and tampering is rejected", () => {
    const enc = encryptTotpSecret("JBSWY3DPEHPK3PXP", "user-a");
    expect(enc).toMatch(/^v1:/);
    expect(decryptTotpSecret(enc, "user-a")).toBe("JBSWY3DPEHPK3PXP");
    expect(decryptTotpSecret(enc, "user-b")).toBeNull();
    expect(decryptTotpSecret(`${enc.slice(0, -2)}AA`, "user-a")).toBeNull();
    expect(decryptTotpSecret("JBSWY3DPEHPK3PXP", "user-a")).toBeNull();
  });

  test("recovery codes: ten distinct codes, hashes ignore case and dashes and differ per user", () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    const c = codes[0]!;
    expect(hashRecoveryCode(c.toUpperCase().replace("-", " "), "u1")).toBe(hashRecoveryCode(c, "u1"));
    expect(hashRecoveryCode(c, "u2")).not.toBe(hashRecoveryCode(c, "u1"));
  });
});

describe("rate limiter during a Redis outage", () => {
  const dead = new Redis("redis://127.0.0.1:1", { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, retryStrategy: () => null });
  afterAll(() => dead.disconnect());

  test("falls back to the in-memory insurance limiter: still limits, never throws a store error", async () => {
    const l = redisLimiter(dead, `outage-${Date.now()}`, 2, 60);
    await expect(l.consume("k")).resolves.toBeDefined();
    await expect(l.consume("k")).resolves.toBeDefined();
    const third = await l.consume("k").catch((e) => e);
    expect(third).not.toBeInstanceOf(Error);
    expect(third.remainingPoints).toBe(0);
  });
});
