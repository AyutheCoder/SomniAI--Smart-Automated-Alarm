import { getServerSession } from "next-auth";
import { isValidObjectId } from "mongoose";
import { authOptions } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongoose";
import { User } from "@/models/User";

/**
 * The signed-in account's id, or null.
 *
 * Sessions are signed tokens that can't be recalled, so a deleted account's
 * token still verifies on any device that held it (7.2). Without this check a
 * second phone or browser could keep writing under the deleted id and quietly
 * make new records for an account that no longer exists. If the database can't
 * be asked, the token is trusted: the route then fails or succeeds on its own,
 * as it did before, and nothing can be written to a database that isn't there.
 */
export async function getUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id ?? null;
  if (!id || !isValidObjectId(id)) {
    return null;
  }
  return (await accountExists(id)) ? id : null;
}

export async function accountExists(id: string): Promise<boolean> {
  try {
    await connectToDatabase();
    return (await User.exists({ _id: id })) !== null;
  }
  catch {
    return true;
  }
}
