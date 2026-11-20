import { describe, expect, it } from "vitest";
import { isAnswer, makeProblem, SUMS } from "./mathChallenge";

/** A seeded source, so the ranges are checked over many sums. */
function seeded(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

describe("the maths wake check's sums", () => {
  it("are three in a row", () => {
    expect(SUMS).toBe(3);
  });

  it("are a × b + c × d with a, c from 2 to 9 and b, d from 3 to 12, every value reached", () => {
    const random = seeded(7);
    const seen = { a: new Set<number>(), b: new Set<number>(), c: new Set<number>(), d: new Set<number>() };
    for (let i = 0; i < 5000; i++) {
      const p = makeProblem(random);
      const m = /^(\d+) × (\d+) \+ (\d+) × (\d+)$/.exec(p.question);
      expect(m).not.toBeNull();
      const [a, b, c, d] = m!.slice(1).map(Number);
      expect(p.answer).toBe(a * b + c * d);
      seen.a.add(a); seen.b.add(b); seen.c.add(c); seen.d.add(d);
    }
    const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    expect([...seen.a].sort((x, y) => x - y)).toEqual(range(2, 9));
    expect([...seen.c].sort((x, y) => x - y)).toEqual(range(2, 9));
    expect([...seen.b].sort((x, y) => x - y)).toEqual(range(3, 12));
    expect([...seen.d].sort((x, y) => x - y)).toEqual(range(3, 12));
  });

  it("covers the extremes: 2 × 3 + 2 × 3 = 12 and 9 × 12 + 9 × 12 = 216", () => {
    expect(makeProblem(() => 0)).toEqual({ question: "2 × 3 + 2 × 3", answer: 12 });
    expect(makeProblem(() => 0.999999)).toEqual({ question: "9 × 12 + 9 × 12", answer: 216 });
  });

  it("accepts only the whole number, as the phone does", () => {
    const p = { question: "2 × 5 + 3 × 11", answer: 43 };
    expect(isAnswer("43", p)).toBe(true);
    expect(isAnswer(" 43 ", p)).toBe(true);
    for (const wrong of ["44", "", " ", "43.0", "4 3", "forty-three", "0x2b", "43abc", "-43"]) {
      expect(isAnswer(wrong, p)).toBe(false);
    }
  });
});
