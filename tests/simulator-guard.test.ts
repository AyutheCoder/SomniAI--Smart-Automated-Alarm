// No production module may import a simulator (prompt 4.4). Simulators live
// in lib/simulators and are used only by "*.dev.ts(x)" files, the developer
// simulator's page and API, which production builds don't contain
// (next.config.ts; `npm run verify` checks the built routes). This fails if
// any production module imports, re-exports or dynamically loads a simulator
// or a dev-only file, or defines a simulator outside lib/simulators.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import nextConfig, { pageExtensions } from "@/next.config";

const ROOT = process.cwd();
const CODE = /\.(ts|tsx|js|mjs)$/;
const TEST = /\.test\.(ts|tsx|js|mjs)$/;
const DEV = /\.dev\.(ts|tsx)$/;

/** Anything that makes values up: the old silent fallbacks and the simulators that replaced them. */
const SIMULATOR_NAMES = [
  "simulateWeather", "simulateCalendar", "simulateWearable", "withSimulated",
  "simulatedMotion", "simulatedMic", "simulatedScreen", "startSimulator", "simulateFallback",
];

const posix = (p: string) => p.split(sep).join("/");

function walk(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

/** Every module that a production build may contain. */
function productionModules(): string[] {
  const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib")), ...walk(join(ROOT, "models")),
    join(ROOT, "middleware.ts"), join(ROOT, "next.config.ts")];
  return files.filter((f) => existsSync(f) && CODE.test(f) && !TEST.test(f) && !DEV.test(f)
    && !posix(relative(ROOT, f)).startsWith("lib/simulators/"));
}

/** Every module specifier a source loads: import/export from, side-effect imports, import(), require(). */
export function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const re of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const m of source.matchAll(re)) {
      out.push(m[1]);
    }
  }
  return out;
}

const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** What's wrong with one production module, as "file: problem" lines. */
export function offences(file: string, source: string): string[] {
  const name = posix(relative(ROOT, file));
  const found: string[] = [];
  for (const spec of specifiers(source)) {
    let target: string | null = null;
    if (spec.startsWith("@/")) {
      target = join(ROOT, spec.slice(2));
    }
    else if (spec.startsWith(".")) {
      target = resolve(dirname(file), spec);
    }
    if (target === null) {
      continue;
    }
    const rel = posix(relative(ROOT, target));
    if (rel === "lib/simulators" || rel.startsWith("lib/simulators/")) {
      found.push(`${name}: imports the simulator ${spec}`);
    }
    else if (/\.dev(\.(ts|tsx))?$/.test(rel)) {
      found.push(`${name}: imports the dev-only ${spec}`);
    }
  }
  const code = withoutComments(source);
  for (const id of SIMULATOR_NAMES) {
    if (new RegExp(`\\b${id}\\b`).test(code)) {
      found.push(`${name}: uses ${id}, which belongs in lib/simulators`);
    }
  }
  return found;
}

describe("no production module imports a simulator", () => {
  const modules = productionModules();

  it("finds the production modules to check", () => {
    // A guard that checks nothing passes for the wrong reason.
    expect(modules.length).toBeGreaterThan(100);
    expect(modules.map((f) => posix(relative(ROOT, f)))).toEqual(expect.arrayContaining([
      "app/page.tsx", "app/api/context/route.ts", "lib/context/index.ts", "lib/sensors/motion.ts", "middleware.ts",
    ]));
  });

  it("none imports lib/simulators or a dev-only file, or defines a simulator", () => {
    const all = modules.flatMap((f) => offences(f, readFileSync(f, "utf8")));
    expect(all).toEqual([]);
  });

  it("the simulators are imported only by dev-only files and tests", () => {
    const sources = ["app", "lib", "models", "tests", "e2e", "scripts", "components"].flatMap((d) => walk(join(ROOT, d)));
    const importers = sources.filter((f) => CODE.test(f))
      .filter((f) => specifiers(readFileSync(f, "utf8")).some((s) => /(^@\/lib\/simulators|\/simulators\/)/.test(s)))
      .map((f) => posix(relative(ROOT, f)));
    expect(importers.length).toBeGreaterThan(0);
    for (const f of importers) {
      expect(f, `${f} imports a simulator`).toMatch(/(\.dev\.(ts|tsx)|\.test\.(ts|tsx))$|^lib\/simulators\//);
    }
  });

  describe("the checker itself", () => {
    const file = join(ROOT, "lib", "example.ts");
    it.each([
      ['import { simulateWeather } from "@/lib/simulators/context";', "imports the simulator @/lib/simulators/context"],
      ['import { simulatedMic } from "../lib/simulators/sensors";', "imports the simulator ../lib/simulators/sensors"],
      ['export { withSimulated } from "./simulators/context";', "imports the simulator ./simulators/context"],
      ['const m = await import("@/lib/simulators/sensors");', "imports the simulator @/lib/simulators/sensors"],
      ['const m = require("./simulators");', "imports the simulator ./simulators"],
      ['import "@/lib/simulators/context";', "imports the simulator @/lib/simulators/context"],
      ['import Page from "@/app/simulator/page.dev";', "imports the dev-only @/app/simulator/page.dev"],
      ["export function simulateCalendar() { return []; }", "uses simulateCalendar, which belongs in lib/simulators"],
      ["private startSimulator() {}", "uses startSimulator, which belongs in lib/simulators"],
    ])("catches %s", (source, problem) => {
      // Importing a simulator by name is also using it: both are reported.
      expect(offences(file, source)).toContain(`lib/example.ts: ${problem}`);
    });

    it("lets real imports and comments about simulators through", () => {
      expect(offences(file, [
        'import { fetchWeather } from "@/lib/context";',
        'import { createMotionAdapter } from "@/lib/sensors";',
        "// These were always simulateWearable() numbers, and went straight in.",
        "/* made up only in lib/simulators (withSimulated) */",
      ].join("\n"))).toEqual([]);
    });
  });
});

describe("the developer simulator is not in production builds", () => {
  it("only `next dev` takes the .dev page and route files", () => {
    expect(pageExtensions(PHASE_DEVELOPMENT_SERVER)).toEqual(expect.arrayContaining(["dev.tsx", "dev.ts"]));
    for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER]) {
      expect(pageExtensions(phase).some((e) => e.startsWith("dev."))).toBe(false);
      expect(nextConfig(phase).pageExtensions).toEqual(pageExtensions(phase));
    }
  });

  it("the simulator's page and API exist only as .dev files", () => {
    expect(existsSync(join(ROOT, "app", "simulator", "page.dev.tsx"))).toBe(true);
    expect(walk(join(ROOT, "app", "simulator")).filter((f) => /[\\/]page\.(tsx|ts|jsx|js)$/.test(f))).toEqual([]);
    expect(walk(join(ROOT, "app", "api", "dev")).filter((f) => /[\\/]route\.(tsx|ts|jsx|js)$/.test(f))).toEqual([]);
    expect(existsSync(join(ROOT, "app", "api", "dev", "simulated-context", "route.dev.ts"))).toBe(true);
  });
});
