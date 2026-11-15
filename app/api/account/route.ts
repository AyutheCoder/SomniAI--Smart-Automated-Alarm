import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, guard, parseJson } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { accountSummary, deleteAccount } from "@/lib/accountData";
import { calendarDeps } from "@/lib/calendarServer";
import { User } from "@/models/User";

/** The account's address, whether it has a password, and how many records of each kind are stored. */
export async function GET() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const summary = await accountSummary(userId);
    return summary ? jsonOk(summary) : jsonError("Unauthorized", 401);
  });
}

/**
 * Deletes the account and everything stored about it (lib/accountData.ts, 7.2).
 *
 * Body: { confirm: the account's email address, password: its password if it
 * has one }. Typing the address is the "yes, really"; the password makes sure
 * it's the account's owner and not someone at an unlocked phone. An account
 * made with Google has no password here, so the address is all it asks.
 */
export async function DELETE(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = await parseJson<{ confirm?: unknown; password?: unknown }>(req);
    if (!body) {
      return jsonError("Invalid request body", 400);
    }
    await connectToDatabase();
    const user = await User.findById(userId).select("+passwordHash").lean<{ email: string; passwordHash?: string }>();
    if (!user) {
      return jsonError("Unauthorized", 401);
    }
    if (typeof body.confirm !== "string" || body.confirm.trim().toLowerCase() !== user.email) {
      return jsonError("Type your account's email address to confirm.", 422);
    }
    if (user.passwordHash) {
      if (typeof body.password !== "string" || body.password.length === 0) {
        return jsonError("Enter your password to confirm.", 422);
      }
      if (!(await bcrypt.compare(body.password, user.passwordHash))) {
        return jsonError("That password isn't right.", 403);
      }
    }
    const result = await deleteAccount(userId, calendarDeps());
    if (!result) {
      return jsonError("Unauthorized", 401);
    }
    return jsonOk(result);
  });
}
