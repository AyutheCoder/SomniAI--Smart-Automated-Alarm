import { probeAiBrain } from "@/lib/uptime";
import { connectToDatabase } from "@/lib/mongoose";

/**
 * Is this deployment working (prompt 7.4)? Public, for the deploy's checks
 * and outside uptime monitors: whether the database answers, whether the AI
 * Brain does, which environment and commit this is. Nothing about anyone.
 * 200 when the database answers (the app works, with or without the AI
 * Brain, which has fallbacks); 503 when it doesn't.
 */
export async function GET() {
  let database: "up" | "down" = "down";
  try {
    const m = await connectToDatabase();
    await m.connection.db!.admin().ping();
    database = "up";
  }
  catch {
    // Reported as down; the reason is the server log's.
  }
  // As the uptime check judges it (lib/uptime.ts): answering, with its models loaded.
  const url = process.env.AI_BRAIN_URL?.trim();
  const aiBrain = !url ? "not_configured" : (await probeAiBrain(url, fetch as never, 4000)).ok ? "up" : "down";
  return Response.json(
    {
      ok: database === "up",
      database,
      aiBrain,
      environment: process.env.SOMNIAI_ENV ?? "development",
      commit: process.env.SOMNIAI_COMMIT ?? null,
      ...(database === "up" ? {} : { error: "The database isn't answering." }),
    },
    { status: database === "up" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
