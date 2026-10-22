// `next dev` compiles each route the first time it is requested, which on a
// cold start can take longer than a flow waits for the alarm's own requests:
// the first runs here saw POST /fire still compiling ten seconds after the
// alarm rang. Requesting every API route once before the flows start keeps
// their timing about the app rather than the compiler.
//
// The requests are made signed in: middleware.ts redirects signed-out /api
// calls to the sign-in page before they reach a route, so they would compile
// nothing. A route counts as warm when it answers in the app's own JSON shape,
// refusals included (the wake planner's 503 "AI Brain offline" is deliberate).
// A 500, a non-JSON answer such as a compile-error page, or a timeout fails
// the run here instead of mid-flow.
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { request, type FullConfig } from "@playwright/test";

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      return routeFiles(p);
    }
    return e.name === "route.ts" ? [p] : [];
  });
}

/** "app/api/alarms/[id]/fire/route.ts" -> "/api/alarms/000000000000000000000000/fire" */
function urlFor(file: string): string | null {
  const parts = relative(join(process.cwd(), "app"), file).split(sep).slice(0, -1);
  if (parts.some((p) => p.startsWith("[..."))) {
    return null; // NextAuth's catch-all, compiled by the sign-in below
  }
  return "/" + parts.map((p) => (p === "[id]" ? "000000000000000000000000" : p)).join("/");
}

export default async function warmup(config: FullConfig) {
  const api = await request.newContext({ baseURL: config.projects[0].use.baseURL, timeout: 120_000 });
  try {
    const email = `warmup-${Date.now()}@example.test`;
    const password = "warmup-password-1";
    const registered = await api.post("/api/auth/register", { data: { email, password } });
    if (registered.status() !== 201) {
      throw new Error(`warm-up: register answered ${registered.status()}`);
    }
    const { csrfToken } = await (await api.get("/api/auth/csrf")).json();
    await api.post("/api/auth/callback/credentials", { form: { csrfToken, email, password, json: "true" } });
    const session = await (await api.get("/api/auth/session")).json();
    if (!session?.user?.id) {
      throw new Error("warm-up: could not sign in");
    }

    const urls = routeFiles(join(process.cwd(), "app", "api")).map(urlFor).filter((u): u is string => u !== null);
    for (const path of urls) {
      // POST to a GET-only route answers 405 with no body, which still compiles it.
      const res = await api.post(path, { data: {}, maxRedirects: 0 });
      if (res.status() === 405) {
        continue;
      }
      const body = await res.json().catch(() => null);
      if (res.status() === 500 || typeof body?.ok !== "boolean") {
        throw new Error(`warm-up: POST ${path} answered ${res.status()}: ${(await res.text()).slice(0, 300)}`);
      }
    }
  }
  finally {
    await api.dispose();
  }
}
