import { jsonError, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { exportAccount } from "@/lib/accountData";

/** Everything stored about the account (lib/accountData.ts), as one JSON file to download (7.2). */
export async function GET() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const data = await exportAccount(userId);
    if (!data) {
      return jsonError("Unauthorized", 401);
    }
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="somniai-data-${data.exportedAt.slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  });
}
