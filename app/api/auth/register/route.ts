import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { connectToDatabase } from "@/lib/mongoose";
import { User } from "@/models/User";
import { jsonError, jsonOk, parseJson, guard, routeError } from "@/lib/http";

interface RegisterBody {
  email?: string;
  password?: string;
  name?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  return guard(async () => {
    const body = await parseJson<RegisterBody>(req);
    if (!body) {
      return jsonError("Invalid request body", 400);
    }
    // Non-string fields used to crash (.toLowerCase on a number: 500) or reach
    // bcrypt (a 503 that echoed "Illegal arguments" back to the caller).
    const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const name = typeof body.name === "string" ? body.name.trim() : undefined;

    if (!email || !EMAIL_RE.test(email)) {
      return jsonError("A valid email is required", 400);
    }
    if (password.length < 8) {
      return jsonError("Password must be at least 8 characters", 400);
    }
    // bcrypt ignores everything past 72 bytes, so two long passwords sharing
    // their first 72 bytes would both unlock the account.
    if (Buffer.byteLength(password, "utf8") > 72) {
      return jsonError("Password must be 72 characters or fewer", 400);
    }

    try {
      await connectToDatabase();
      const existing = await User.findOne({ email });
      if (existing) {
        return jsonError("An account with that email already exists", 409);
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await User.create({
        email,
        name: name || undefined,
        passwordHash,
        provider: "credentials",
      });

      return jsonOk({ id: String(user._id), email: user.email }, { status: 201 });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown error";
      const isDbConnection = /MONGO_DB_URI|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|querySrv|getaddrinfo|server selection|topology/i.test(detail);
      if (isDbConnection) {
        console.error("[auth/register] failed:", detail);
        return jsonError(
          "Database is not reachable. Make sure MongoDB is running and MONGO_DB_URI in .env.local is correct.",
          503,
        );
      }
      // Everything else used to come back as a 503 quoting the raw error: a
      // too-long name said "Could not create account: User validation failed:
      // name: Path `name` ...", and a sign-up race was a 503 instead of a 409.
      return routeError(err);
    }
  });
}