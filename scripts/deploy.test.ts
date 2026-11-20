import { describe, expect, it } from "vitest";
import { androidServerUrl, appEnv, ensureSecrets, ENVIRONMENTS, parseEnv } from "./deploy.mjs";

const deployFile = {
  VERCEL_TOKEN: "t", RENDER_API_KEY: "r",
  ATLAS_STAGING_URI: "mongodb+srv://s@x/somniai-staging", ATLAS_PRODUCTION_URI: "mongodb+srv://p@x/somniai-production",
  SOMNIAI_OPERATOR: "Operator", SOMNIAI_CONTACT: "ops@example.org", SOMNIAI_JURISDICTION: "Law of somewhere.",
};
const local = { GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gsec", FIREBASE_PROJECT_ID: "fp", TWILIO_ACCOUNT_SID: "tw", RATE_LIMIT_DISABLED: "1" };
const urls = { app: "https://somniai.vercel.app", brain: "https://somniai-brain.onrender.com" };

describe("the deploy file", () => {
  it("reads KEY=value lines, quoted or not, and skips comments", () => {
    expect(parseEnv('# note\nA=1\nB="two words"\nC=\'x=y\'\n# D=hidden\nE=\n')).toEqual({ A: "1", B: "two words", C: "x=y", E: "" });
  });

  it("makes each environment's secrets once, and staging's test key", () => {
    const env: Record<string, string> = { PRODUCTION_CRON_SECRET: "kept" };
    let n = 0;
    expect(ensureSecrets(env, "PRODUCTION", () => `made-${n++}`)).toEqual(["PRODUCTION_NEXTAUTH_SECRET", "PRODUCTION_AI_BRAIN_TOKEN"]);
    expect(env.PRODUCTION_CRON_SECRET).toBe("kept");
    expect(ensureSecrets(env, "PRODUCTION")).toEqual([]);
    expect(ensureSecrets(env, "STAGING", () => "s")).toEqual(["STAGING_NEXTAUTH_SECRET", "STAGING_CRON_SECRET", "STAGING_AI_BRAIN_TOKEN", "STAGING_TEST_KEY"]);
  });
});

describe("what each environment's web app gets", () => {
  const file: Record<string, string> = { ...deployFile };
  ensureSecrets(file, "STAGING");
  ensureSecrets(file, "PRODUCTION");

  it("production: its own database and secrets, the operator's details, no test key", () => {
    const vars = appEnv("production", file, local, urls);
    expect(vars).toMatchObject({
      SOMNIAI_ENV: "production", MONGO_DB_URI: deployFile.ATLAS_PRODUCTION_URI, NEXTAUTH_URL: urls.app, AI_BRAIN_URL: urls.brain,
      NEXTAUTH_SECRET: file.PRODUCTION_NEXTAUTH_SECRET, AI_BRAIN_TOKEN: file.PRODUCTION_AI_BRAIN_TOKEN,
      SOMNIAI_OPERATOR: "Operator", SOMNIAI_CONTACT: "ops@example.org", SOMNIAI_JURISDICTION: "Law of somewhere.",
    });
    expect(vars.SOMNIAI_HOSTING).toMatch(/Vercel.*Render.*Atlas/);
    expect(vars.SOMNIAI_BACKUPS).toMatch(/no backups/);
    expect(vars).not.toHaveProperty("STAGING_TEST_KEY");
  });

  it("staging: its own database and secrets, the test key, no operator's details", () => {
    const vars = appEnv("staging", file, local, urls);
    expect(vars).toMatchObject({ SOMNIAI_ENV: "staging", MONGO_DB_URI: deployFile.ATLAS_STAGING_URI, STAGING_TEST_KEY: file.STAGING_TEST_KEY });
    expect(vars.NEXTAUTH_SECRET).not.toBe(file.PRODUCTION_NEXTAUTH_SECRET);
    expect(vars).not.toHaveProperty("SOMNIAI_OPERATOR");
  });

  it("neither turns rate limits off, and Google sign-in waits for its redirect addresses", () => {
    for (const name of Object.keys(ENVIRONMENTS)) {
      const vars = appEnv(name, file, local, urls);
      expect(vars).not.toHaveProperty("RATE_LIMIT_DISABLED");
      expect(vars.NEXT_PUBLIC_GOOGLE_ENABLED).toBe("false");
      expect(Object.values(vars).every((v) => typeof v === "string" && v !== "")).toBe(true);
    }
  });
});

describe("the Android app's server", () => {
  it("is production's address, and only over HTTPS", () => {
    expect(androidServerUrl({ staging: { app: "https://s.vercel.app" }, production: { app: "https://somniai.vercel.app" } })).toBe("https://somniai.vercel.app");
    expect(() => androidServerUrl({ staging: { app: "https://s.vercel.app" } })).toThrow(/production isn't deployed/);
    expect(() => androidServerUrl({ production: { app: "http://somniai.vercel.app" } })).toThrow(/must be https/);
  });
});
