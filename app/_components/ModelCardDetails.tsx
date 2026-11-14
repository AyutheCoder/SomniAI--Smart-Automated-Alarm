import { cardLines, MODEL_CARD } from "@/lib/modelCard";

/**
 * How the AI Brain's predictions are made (prompt 5.2): the shipped model
 * card, in plain words, every figure measured on people the models never saw.
 * Shown whichever made the predictions, so the user can judge both.
 */
export default function ModelCardDetails() {
  return (
    <details className="rounded-lg border border-white/5 bg-slate-900/40 p-3 text-xs text-slate-300">
      <summary className="cursor-pointer text-slate-400">How the AI Brain&apos;s predictions are made</summary>
      {cardLines().map((section) => (
        <div key={section.heading} className="mt-2">
          <p className="font-medium text-slate-200">{section.heading}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {section.lines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      ))}
      <p className="mt-2 text-slate-500">
        When the AI Brain isn&apos;t reachable, predictions come from simple rules instead, and are labelled so.
        Trained {new Date(MODEL_CARD.trainedAt).toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" })}.
      </p>
    </details>
  );
}
