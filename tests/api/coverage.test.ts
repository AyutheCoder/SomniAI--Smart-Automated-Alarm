// Keeps "every API route has tests" true as routes are added: each handler a
// route file exports must be imported by at least one API test file.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function walk(dir: string, match: (f: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p, match) : match(e.name) ? [p] : [];
  });
}

/** "app/api/alarms/[id]/route.ts" -> "alarms/[id]" */
const routeKey = (file: string) =>
  relative(join(ROOT, "app", "api"), file).split(sep).slice(0, -1).join("/");

function exportedMethods(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) {
    found.add(m[1]);
  }
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      found.add(part.trim().split(/\s+as\s+/).pop()!.trim());
    }
  }
  return [...found].filter((name) => METHODS.includes(name));
}

const routes = walk(join(ROOT, "app", "api"), (f) => f === "route.ts").map((file) => ({
  key: routeKey(file),
  methods: exportedMethods(readFileSync(file, "utf8")),
}));

const tested = new Map<string, Set<string>>();
for (const file of walk(join(ROOT, "tests", "api"), (f) => f.endsWith(".test.ts"))) {
  const source = readFileSync(file, "utf8");
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/app\/api\/(.+?)\/route"/g)) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    const set = tested.get(m[2]) ?? new Set<string>();
    names.forEach((n) => set.add(n));
    tested.set(m[2], set);
  }
}

describe("API route coverage", () => {
  // DEVELOPMENT_PLAN.md says 22; there are 23 route files. Update this count
  // deliberately when adding or removing a route, alongside its tests.
  it("finds all 23 route files", () => {
    expect(routes).toHaveLength(23);
  });

  it.each(routes.flatMap((r) => r.methods.map((m) => [`${m} /api/${r.key}`, r.key, m] as const)))(
    "%s is exercised by a test",
    (_name, key, method) => {
      expect([...(tested.get(key) ?? [])]).toContain(method);
    },
  );
});
