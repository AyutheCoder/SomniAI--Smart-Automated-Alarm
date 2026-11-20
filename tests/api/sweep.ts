// Every API route, called as a test would (prompt 7.3's failure-mode suites):
// each handler of each route file under app/api, with a minimal request, so a
// route added later is swept too without anyone remembering to list it.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { MISSING_ID, params, request } from "./helpers";

const ROOT = process.cwd();
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export interface RouteCall {
  /** "alarms/[id]/fire" */
  key: string;
  method: (typeof METHODS)[number];
  call: () => Promise<Response>;
}

/** Every handler of every production route (route.dev.ts files are the simulator's, not production). */
export async function everyRoute(): Promise<RouteCall[]> {
  const files = walk(join(ROOT, "app", "api")).filter((f) => f.endsWith(`${sep}route.ts`));
  const out: RouteCall[] = [];
  for (const file of files) {
    const key = relative(join(ROOT, "app", "api"), dirname(file)).split(sep).join("/");
    const mod = (await import(`@/app/api/${key}/route`)) as Record<string, unknown>;
    // Dynamic segments get a well-formed id that belongs to nothing.
    const segments = Object.fromEntries([...key.matchAll(/\[(\w+)\]/g)].map((m) => [m[1], MISSING_ID]));
    const path = `/api/${key.replace(/\[(\w+)\]/g, MISSING_ID)}`;
    for (const method of METHODS) {
      const handler = mod[method];
      if (typeof handler === "function") {
        out.push({
          key,
          method,
          call: () => (handler as (req: unknown, ctx: unknown) => Promise<Response>)(
            request(method, path, method === "GET" || method === "DELETE" ? undefined : {}),
            params(segments),
          ),
        });
      }
    }
  }
  return out;
}

/** What a failure-mode suite requires of an answer: never a crash, always something a person can read. */
export async function answeredClearly(res: Response): Promise<string | null> {
  if (res.status === 500) {
    return `500: ${await res.text()}`;
  }
  if (res.status >= 300 && res.status < 400) {
    return null; // A redirect (Google's consent screen, back to the page) is an answer.
  }
  const text = await res.text();
  if (res.status >= 400) {
    let body: { error?: unknown } | null = null;
    try {
      body = JSON.parse(text);
    }
    catch {
      return `${res.status} without a JSON body: ${text.slice(0, 80)}`;
    }
    if (typeof body?.error !== "string" || body.error.trim() === "") {
      return `${res.status} without an error message: ${text.slice(0, 80)}`;
    }
  }
  return null;
}

/** Routes whose code reaches `target` (a file under the repository), following imports. */
export function routesReaching(target: string): string[] {
  const goal = join(ROOT, target);
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
    if (!base) {
      return null;
    }
    for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (existsSync(c) && statSync(c).isFile()) {
        return c;
      }
    }
    return null;
  };
  const reaches = (file: string, seen: Set<string>): boolean => {
    if (file === goal) {
      return true;
    }
    if (seen.has(file)) {
      return false;
    }
    seen.add(file);
    const src = readFileSync(file, "utf8");
    return [...src.matchAll(/(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)]
      .some((m) => {
        const next = resolve(file, m[1] ?? m[2]);
        return next !== null && reaches(next, seen);
      });
  };
  return walk(join(ROOT, "app", "api"))
    .filter((f) => f.endsWith(`${sep}route.ts`) && reaches(f, new Set()))
    .map((f) => relative(join(ROOT, "app", "api"), dirname(f)).split(sep).join("/"))
    .sort();
}
