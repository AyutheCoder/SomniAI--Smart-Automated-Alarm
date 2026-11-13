// Tonight's plan on the server (prompt 3.4): the bedtime chosen in the wake
// planner is kept on this device for the reminder (lib/bedtime.ts) and sent
// to the account, so the morning report can say whether it was kept.

type Post = (url: string, init: { method: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean }>;

export async function saveNightPlan(plan: { at: string; wakeAt: string }, send: Post = fetch): Promise<"saved" | "failed"> {
  try {
    const res = await send("/api/night-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bedtime: plan.at, wakeAt: plan.wakeAt }),
    });
    return res.ok ? "saved" : "failed";
  }
  catch {
    return "failed";
  }
}

export async function cancelNightPlan(send: Post = fetch): Promise<"saved" | "failed"> {
  try {
    return (await send("/api/night-plans", { method: "DELETE" })).ok ? "saved" : "failed";
  }
  catch {
    return "failed";
  }
}
