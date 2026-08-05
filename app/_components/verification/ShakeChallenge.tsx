"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Smartphone } from "lucide-react";
import type { ChallengeProps } from "./types";

const SHAKE_THRESHOLD = 14;
const SHAKES_REQUIRED = 8;
const TAPS_REQUIRED = 20;

type DeviceMotionEventCtor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export default function ShakeChallenge({ onComplete }: ChallengeProps) {
  const startedAt = useMemo(() => Date.now(), []);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [progress, setProgress] = useState(0);
  const [taps, setTaps] = useState(0);
  const peak = useRef(0);
  const required = useRef(SHAKES_REQUIRED);
  const done = useRef(false);

  const finish = (interactions: number) => {
    if (done.current) return;
    done.current = true;
    const motion = Math.min(1, peak.current / 30);
    onComplete({
      type: "shake",
      passed: true,
      attempts: 0,
      responseMs: Date.now() - startedAt,
      motion,
      interactions,
    });
  };

  const attachListener = () => {
    let count = 0;
    const handler = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;
      const mag = Math.sqrt((acc.x ?? 0) ** 2 + (acc.y ?? 0) ** 2 + (acc.z ?? 0) ** 2);
      const delta = Math.abs(mag - 9.81);
      peak.current = Math.max(peak.current, delta);
      if (delta > SHAKE_THRESHOLD) {
        count += 1;
        setProgress(Math.min(1, count / required.current));
        if (count >= required.current) {
          window.removeEventListener("devicemotion", handler);
          finish(count);
        }
      }
    };
    window.addEventListener("devicemotion", handler);
    return () => window.removeEventListener("devicemotion", handler);
  };

  useEffect(() => {
    if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) {
      setSupported(false);
      return;
    }
    const ctor = window.DeviceMotionEvent as DeviceMotionEventCtor;
    if (typeof ctor.requestPermission === "function") {
      setSupported(true);
      setNeedsPermission(true);
      return;
    }
    setSupported(true);
    return attachListener();
  }, []);

  async function requestPermission() {
    const ctor = window.DeviceMotionEvent as DeviceMotionEventCtor;
    try {
      const res = await ctor.requestPermission?.();
      if (res === "granted") {
        setNeedsPermission(false);
        attachListener();
      } else {
        setSupported(false);
      }
    } catch {
      setSupported(false);
    }
  }

  function tap() {
    const next = taps + 1;
    setTaps(next);
    peak.current = Math.max(peak.current, 12 + Math.random() * 6);
    setProgress(Math.min(1, next / TAPS_REQUIRED));
    if (next >= TAPS_REQUIRED) {
      finish(next);
    }
  }

  const useFallback = supported === false;

  return (
    <div>
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
        {useFallback ? (
          <Activity className="h-8 w-8 text-emerald-300" />
        ) : (
          <Smartphone className="h-8 w-8 text-emerald-300" />
        )}
      </div>
      <h3 className="text-lg font-semibold text-white">
        {useFallback ? "Tap rapidly to wake up" : "Shake your device"}
      </h3>
      <p className="mt-2 text-sm text-slate-400">
        {useFallback
          ? `Tap the button ${TAPS_REQUIRED} times as fast as you can.`
          : `Give it ${SHAKES_REQUIRED} firm shakes.`}
      </p>

      <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-slate-700">
        <div
          className="h-full rounded-full bg-emerald-400 transition-all"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {needsPermission && (
        <button
          onClick={requestPermission}
          className="mt-5 rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-white transition hover:bg-emerald-400"
        >
          Enable motion sensor
        </button>
      )}

      {useFallback && (
        <button
          onClick={tap}
          className="mt-5 w-full select-none rounded-xl bg-emerald-500 px-6 py-4 text-lg font-semibold text-white transition hover:bg-emerald-400 active:scale-95"
        >
          Tap! ({taps}/{TAPS_REQUIRED})
        </button>
      )}
    </div>
  );
}