import { describe, expect, it } from "vitest";
import { secretValues, shapesIn } from "./check-secrets.mjs";

// Built at run time, so this file never holds anything shaped like a credential itself.
const fake = {
  google: ["GOC", "SPX-", "a".repeat(28)].join(""),
  twilio: ["A", "C", "0123456789abcdef".repeat(2)].join(""),
  pem: ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
  mongo: ["mongodb+srv://", "admin:hunter2", "@cluster0.example.net/db"].join(""),
  jwt: ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "c2lnbmF0dXJlLXJlYWw"].join("."),
};

describe("the secret check", () => {
  it("collects the environment's secret values, not public ones, booleans, or addresses without a password", () => {
    const values = secretValues([
      "NEXTAUTH_SECRET=abcdefghijklmnop",
      "NEXT_PUBLIC_FIREBASE_API_KEY=meant-for-the-browser",
      "MONGO_DB_URI=mongodb://localhost:27017/somniai",
      "REMOTE_DB=" + fake.mongo,
      "FLAG=true",
      "SHORT=abc",
    ].join("\n"), { CRON_SECRET: "c".repeat(64), PATH: "/usr/bin:/bin" });
    expect([...values.keys()].sort()).toEqual(["CRON_SECRET", "NEXTAUTH_SECRET", "REMOTE_DB"]);
  });

  it("recognises credential shapes, and lets the known test placeholders through", () => {
    expect(shapesIn(`const s = "${fake.google}";`)).toEqual(["Google OAuth client secret"]);
    expect(shapesIn(fake.twilio)).toEqual(["Twilio account SID"]);
    expect(shapesIn(fake.pem)).toEqual(["private key"]);
    expect(shapesIn(fake.mongo)).toEqual(["MongoDB URI with a password"]);
    expect(shapesIn(fake.jwt)).toEqual(["JWT"]);
    expect(shapesIn("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMDAwMDAwMDAwIn0.fixture-signature")).toEqual([]);
    expect(shapesIn("nothing to see: localhost, GOCSPX-short")).toEqual([]);
  });
});
