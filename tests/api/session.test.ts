// The real lib/session.ts (the other API tests replace it with a stub): a
// deleted account's session token still verifies, so the account itself is
// checked (7.2). Otherwise a second phone still signed in would keep writing
// records under an id whose account no longer exists.
import { describe, expect, it, vi } from "vitest";
import { MISSING_ID, makeUser } from "./helpers";
import { User } from "@/models/User";

const signedInAs: { id: string | null } = { id: null };
vi.mock("next-auth", async (original) => ({
  ...(await original<typeof import("next-auth")>()),
  getServerSession: async () => (signedInAs.id ? { user: { id: signedInAs.id }, expires: "" } : null),
}));

const real = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");

describe("who is signed in", () => {
  it("is the token's account while it exists, and no one once it's deleted", async () => {
    const id = await makeUser();
    signedInAs.id = id;
    expect(await real.getUserId()).toBe(id);
    await User.deleteOne({ _id: id });
    expect(await real.getUserId()).toBeNull();
  });

  it("is no one for a token naming no account, or nothing usable", async () => {
    await makeUser();
    signedInAs.id = MISSING_ID;
    expect(await real.getUserId()).toBeNull();
    signedInAs.id = "not-an-object-id";
    expect(await real.getUserId()).toBeNull();
    signedInAs.id = null;
    expect(await real.getUserId()).toBeNull();
  });
});
