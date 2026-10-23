// Nothing at ring time may call the server. The ringing screen and every
// module it imports, followed to the end, must contain no way to make a
// network request. (What the page does after the ring goes through the outbox.)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ENTRY = "app/_components/RingingOverlay.tsx";

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
  if (!base) {
    return null; // a package: react, lucide-react
  }
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && !candidate.endsWith("/") && /\.(ts|tsx)$/.test(candidate)) {
      return candidate;
    }
  }
  throw new Error(`can't resolve ${spec} from ${relative(ROOT, from)}`);
}

function ringTimeModules(): string[] {
  const seen = new Set<string>();
  const queue = [join(ROOT, ENTRY)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/(?:import|export)\s[^;]*?from\s+"([^"]+)"/g)) {
      const next = resolveImport(file, m[1]);
      if (next) {
        queue.push(next);
      }
    }
  }
  return [...seen].map((f) => relative(ROOT, f).split("\\").join("/")).sort();
}

const NETWORK = [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /new WebSocket/, /EventSource/, /["'`]\/api\//];

describe("ring time", () => {
  const modules = ringTimeModules();

  it("covers the ringing screen, the ladder, the plan, the challenges and the backups", () => {
    expect(modules).toEqual(expect.arrayContaining([
      ENTRY,
      "lib/ringPlan.ts",
      "lib/escalation.ts",
      "lib/clientAlarm.ts",
      "lib/backupAdapters.ts",
      "lib/wakeConfidence.ts",
      "app/_components/verification/MathChallenge.tsx",
    ]));
  });

  it.each(modules)("%s makes no network request", (file) => {
    const code = readFileSync(join(ROOT, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(NETWORK.filter((re) => re.test(code)).map((re) => re.source)).toEqual([]);
  });
});
