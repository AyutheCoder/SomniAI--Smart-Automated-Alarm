import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { exportTelemetry } from "@/lib/telemetry";

/** Everything held about the user's telemetry, as a JSON file to download. */
export async function GET() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const data = await exportTelemetry(userId);
    const day = data.exportedAt.slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="somniai-telemetry-${day}.json"`,
        "cache-control": "no-store",
      },
    });
  });
}
