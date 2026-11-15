import Link from "next/link";
import { Moon } from "lucide-react";
import { Markdown } from "@/lib/markdown";

/** A public page of text (privacy policy, terms, deleting an account): readable signed out (7.2). */
export default function LegalPage({ source, missing = [] }: { source: string; missing?: string[] }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed text-slate-300">
      <Link href="/" className="mb-8 flex items-center gap-2 text-slate-400 hover:text-slate-200">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-sky-500">
          <Moon className="h-4 w-4 text-white" />
        </span>
        SomniAI
      </Link>
      {missing.length > 0 && (
        <p role="alert" className="mb-6 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-amber-100">
          This copy of SomniAI hasn&apos;t filled in who runs it: {missing.join(", ")} {missing.length === 1 ? "is" : "are"} not set.
          The text below is incomplete until {missing.length === 1 ? "it is" : "they are"}.
        </p>
      )}
      <Markdown source={source} />
      <nav className="mt-10 flex gap-4 border-t border-white/10 pt-4 text-xs text-slate-500">
        <Link href="/privacy" className="hover:text-slate-300">Privacy policy</Link>
        <Link href="/terms" className="hover:text-slate-300">Terms</Link>
        <Link href="/delete-account" className="hover:text-slate-300">Delete your account</Link>
      </nav>
    </main>
  );
}
