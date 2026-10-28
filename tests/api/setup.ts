// Runs before every API test file, before the file's own imports.
import "./env";
import mongoose from "mongoose";
import { afterAll, beforeEach, vi } from "vitest";
import { session } from "./helpers";

// Who is signed in is the one thing faked. NextAuth's own JWT handling is the
// library's job; these tests check that every route enforces the identity it
// is given.
vi.mock("@/lib/session", () => ({
  getUserId: async () => session.userId,
}));

beforeEach(async () => {
  session.userId = null;
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});
