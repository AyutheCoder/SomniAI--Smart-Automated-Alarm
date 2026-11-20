import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { User } from "@/models/User";

/** The identity the stubbed getUserId() returns; null means signed out. */
export const session: { userId: string | null } = { userId: null };

export function signInAs(userId: string | null) {
  session.userId = userId;
}

/**
 * A request as the route handler receives it. A string body is sent verbatim
 * (for malformed JSON); anything else is JSON-encoded.
 */
export function request(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(new URL(path, "http://localhost"), {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** The second argument Next passes to a dynamic route handler. */
export function params<T extends Record<string, string | string[]>>(p: T) {
  return { params: Promise.resolve(p) };
}

export const idParams = (id: string) => params({ id });

// Response bodies are whatever each route returns; tests assert on shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = { ok: boolean; error?: string; data?: any };

export async function read(res: Response): Promise<{ status: number; body: Json }> {
  return { status: res.status, body: (await res.json()) as Json };
}

export async function makeUser(fields: Record<string, unknown> = {}): Promise<string> {
  await connectToDatabase();
  const user = await User.create({ email: `${randomUUID()}@test.invalid`, ...fields });
  return String(user._id);
}

/** Two signed-up users; the test signs in as one and probes the other's data. */
export async function twoUsers() {
  return { alice: await makeUser(), bob: await makeUser() };
}

/** An id that is well-formed but belongs to nothing. */
export const MISSING_ID = "64b000000000000000000000";
