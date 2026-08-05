import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { connectToDatabase } from "@/lib/mongoose";
import { User } from "@/models/User";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";

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
    const email = body.email?.toLowerCase().trim();
    const password = body.password;
    const name = body.name?.trim();

    if (!email || !EMAIL_RE.test(email)) {
      return jsonError("A valid email is required", 400);
    }
    if (!password || password.length < 8) {
      return jsonError("Password must be at least 8 characters", 400);
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
      console.error("[auth/register] failed:", detail);
      const isDbConnection = /MONGO_DB_URI|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|querySrv|getaddrinfo|server selection|topology/i.test(detail);
      return jsonError(
        isDbConnection
          ? "Database is not reachable. Make sure MongoDB is running and MONGO_DB_URI in .env.local is correct."
          : `Could not create account: ${detail}`,
        503
      );
    }
  });
}