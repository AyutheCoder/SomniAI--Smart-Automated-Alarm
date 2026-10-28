import { Sparkles } from "lucide-react";
import { ORIGIN_LABEL, type ConfidenceText, type PredictionOrigin as Origin } from "@/lib/predictionCopy";

/**
 * Where a prediction came from and how far to trust it, in words, shown next
 * to every prediction the app displays.
 */
export default function PredictionOrigin({
  what,
  origin,
  confidence,
}: {
  /** What is being described, e.g. "Predictions" or "Coaching". */
  what: string;
  origin: Origin;
  confidence: ConfidenceText;
}) {
  return (
    <p data-origin={origin} className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-slate-400">
      <Sparkles className="h-3 w-3 self-center text-slate-500" aria-hidden />
      <span>
        {what} from <span className="font-medium text-slate-200">{ORIGIN_LABEL[origin]}</span>
        {" · "}
        <span className="text-slate-300">{confidence.label}</span>.
      </span>
      <span className="text-slate-500">{confidence.detail}</span>
    </p>
  );
}
