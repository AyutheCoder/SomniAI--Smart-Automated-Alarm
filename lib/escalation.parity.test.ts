// The escalation ladder is defined here and climbed natively on Android
// (EscalationLadder.java), from the ring plan cached on the phone. This writes
// the ladders the server can put in a plan (the standard one per strategy, and
// personalised ones for several sleepers, critical and not) to a table the
// Java tests read, and checks the committed table still matches this code.
// Regenerate on purpose with
//   WRITE_PARITY=1 npx vitest run lib/escalation.parity.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEscalationPlan, personalizeEscalationPlan, type EscalationLevel, type EscalationProfile } from "./escalation";
import type { WakeStrategy } from "./types";

const TABLE = join(__dirname, "..", "android", "app", "src", "test", "resources", "escalation-cases.json");
const STRATEGIES: WakeStrategy[] = ["gentle", "adaptive", "aggressive"];

/** Sleepers: an easy waker (slower, backups held back), a hard one (faster), a middling one, and too little history. */
const PROFILES: Record<string, EscalationProfile> = {
  easy: { typicalLevel: 1, reliableLevel: 2, paceFactor: 1.25, samples: 6 },
  hard: { typicalLevel: 4, reliableLevel: 5, paceFactor: 0.6, samples: 9 },
  middling: { typicalLevel: 2, reliableLevel: 3, paceFactor: 1, samples: 4 },
  new: { typicalLevel: 1, reliableLevel: 5, paceFactor: 1, samples: 1 },
};

interface Table {
  shared: Record<string, EscalationLevel[]>;
  personalised: { strategy: WakeStrategy; profile: string; critical: boolean; plan: EscalationLevel[] }[];
}

function build(): Table {
  const shared: Table["shared"] = {};
  const personalised: Table["personalised"] = [];
  for (const strategy of STRATEGIES) {
    shared[strategy] = buildEscalationPlan(strategy);
    for (const [name, profile] of Object.entries(PROFILES)) {
      for (const critical of [false, true]) {
        personalised.push({ strategy, profile: name, critical, plan: personalizeEscalationPlan(buildEscalationPlan(strategy), profile, { critical }) });
      }
    }
  }
  return { shared, personalised };
}

describe("escalation parity table", () => {
  it("matches the table the Android tests check EscalationLadder.java against", () => {
    const table = build();
    if (process.env.WRITE_PARITY === "1") {
      writeFileSync(TABLE, JSON.stringify(table, null, 1) + "\n");
    }
    expect(JSON.parse(readFileSync(TABLE, "utf8"))).toEqual(table);
    // The cases the override exists for are in it: an easy waker's non-critical
    // ladder holds backups back and climbs slower than the standard one.
    const easy = table.personalised.find((c) => c.profile === "easy" && !c.critical && c.strategy === "adaptive")!;
    expect(easy.plan[4].backup).toEqual([]);
    expect(easy.plan[4].afterSeconds).toBeGreaterThan(table.shared.adaptive[4].afterSeconds);
  });
});
