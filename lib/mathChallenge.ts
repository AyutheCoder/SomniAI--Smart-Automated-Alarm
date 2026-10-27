// The maths wake check's sums. The phone makes the same ones natively
// (MathChallenge.java); change both together.

/** Sums in a row to pass one maths challenge. A wrong answer brings a new sum and doesn't count. */
export const SUMS = 3;

export interface MathProblem {
  question: string;
  answer: number;
}

/** a, c from 2 to 9; b, d from 3 to 12. */
export function makeProblem(random: () => number = Math.random): MathProblem {
  const a = 2 + Math.floor(random() * 8);
  const b = 3 + Math.floor(random() * 10);
  const c = 2 + Math.floor(random() * 8);
  const d = 3 + Math.floor(random() * 10);
  return { question: `${a} × ${b} + ${c} × ${d}`, answer: a * b + c * d };
}

/** A whole number and nothing else: "140" and " 140 " are right, "140.0" and "" are not, as on the phone. */
export function isAnswer(input: string, problem: MathProblem): boolean {
  const trimmed = input.trim();
  return /^-?\d+$/.test(trimmed) && Number(trimmed) === problem.answer;
}
