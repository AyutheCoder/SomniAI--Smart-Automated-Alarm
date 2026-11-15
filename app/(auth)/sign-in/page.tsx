"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Moon, Loader2 } from "lucide-react";
import { safeCallbackUrl } from "@/lib/callbackUrl";
import { GOOGLE_REFUSED } from "@/lib/googleSignIn";

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Only a place on this site (lib/callbackUrl.ts): a javascript: callback would run with the new session.
  const callbackUrl = safeCallbackUrl(params.get("callbackUrl"), typeof window === "undefined" ? "http://localhost" : window.location.origin);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(GOOGLE_REFUSED[params.get("error") ?? ""] ?? null);
  // After deleting an account (7.2), the panel signs out to here.
  const deleted = params.get("deleted") === "1";
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("Invalid email or password.");
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {deleted && (
        <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
          Your account and everything stored with it were deleted.
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="space-y-1">
        <label className="text-sm text-slate-300" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none transition focus:border-indigo-400/60 focus:bg-white/10"
          placeholder="you@example.com"
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm text-slate-300" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none transition focus:border-indigo-400/60 focus:bg-white/10"
          placeholder="••••••••"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-sky-500 px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Sign in
      </button>

      {GOOGLE_ENABLED && (
        <>
          <div className="flex items-center gap-3 py-1 text-xs text-slate-500">
            <span className="h-px flex-1 bg-white/10" />
            or
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl })}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
          >
            Continue with Google
          </button>
        </>
      )}
    </form>
  );
}

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500">
            <Moon className="h-5 w-5 text-white" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-white">SomniAI</h1>
            <p className="text-xs text-slate-400">Welcome back</p>
          </div>
        </div>

        <Suspense fallback={<p className="text-sm text-slate-400">Loading…</p>}>
          <SignInForm />
        </Suspense>

        <p className="mt-6 text-center text-sm text-slate-400">
          No account?{" "}
          <Link href="/sign-up" className="text-indigo-300 hover:text-indigo-200">
            Create one
          </Link>
        </p>
        <p className="mt-3 text-center text-xs text-slate-500">
          <Link href="/privacy" className="hover:text-slate-300">Privacy policy</Link>
          {" · "}
          <Link href="/terms" className="hover:text-slate-300">Terms</Link>
        </p>
      </div>
    </main>
  );
}