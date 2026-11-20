import { User } from "lucide-react";
import type { PersonalPredictions as Personal } from "@/lib/personalServer";
import { personalLines } from "@/lib/personalText";

/** Personal predictions (prompt 5.3): yours once you have enough nights, the population model's before, said either way. */
export default function PersonalPredictions({ personal }: { personal: Personal }) {
  return (
    <section aria-label="Personal predictions" className="rounded-lg border border-white/5 bg-slate-900/40 p-3 text-xs text-slate-300">
      <p className="mb-2 flex items-center gap-1.5 font-medium text-slate-200">
        <User className="h-3.5 w-3.5 text-violet-300" /> Just for you
      </p>
      <dl className="space-y-1.5">
        {personalLines(personal).map((l) => (
          <div key={l.what}>
            <dt className="text-slate-400">{l.what}</dt>
            <dd>{l.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
