import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { StudyError, studyState, withdraw } from "@/lib/studyServer";

/** The study's consent document, and whether this user is taking part (prompt 6.2). */
export async function GET() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    return jsonOk(await studyState(userId));
  });
}

/** Leaves the study, at any time: deletes everything it collected. */
export async function DELETE() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    try {
      const deleted = await withdraw(userId);
      return jsonOk({ ...(await studyState(userId)), deleted });
    }
    catch (e) {
      if (e instanceof StudyError) {
        return jsonError(e.message, e.status);
      }
      throw e;
    }
  });
}
