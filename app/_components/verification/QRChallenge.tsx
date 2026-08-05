"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QrCode } from "lucide-react";
import type { ChallengeProps } from "./types";

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}

type BarcodeDetectorCtor = new (opts?: {
  formats?: string[];
}) => BarcodeDetectorLike;

function randomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function QRChallenge({ onComplete }: ChallengeProps) {
  const startedAt = useMemo(() => Date.now(), []);
  const code = useMemo(randomCode, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState<"camera" | "manual" | "loading">("loading");
  const [input, setInput] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState("");
  const done = useRef(false);

  const finish = (interactions: number) => {
    if (done.current) return;
    done.current = true;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onComplete({
      type: "qr",
      passed: true,
      attempts,
      responseMs: Date.now() - startedAt,
      interactions,
    });
  };

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

    async function startCamera() {
      if (!Detector || !navigator.mediaDevices?.getUserMedia) {
        setMode("manual");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setMode("camera");
        const detector = new Detector({ formats: ["qr_code"] });
        const scan = async () => {
          if (cancelled || done.current || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) {
              finish(1);
              return;
            }
          } catch {
            // ignore scan errors
          }
          raf = requestAnimationFrame(scan);
        };
        raf = requestAnimationFrame(scan);
      } catch {
        setMode("manual");
      }
    }

    startCamera();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    if (input.trim().toUpperCase() === code) {
      finish(attempts + 1);
    } else {
      setAttempts((a) => a + 1);
      setError("Code doesn't match.");
    }
  }

  return (
    <div>
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20">
        <QrCode className="h-8 w-8 text-amber-300" />
      </div>

      {mode === "camera" && (
        <>
          <h3 className="text-lg font-semibold text-white">Scan any QR code</h3>
          <p className="mt-2 text-sm text-slate-400">
            Point your camera at a QR code to prove you&apos;re up.
          </p>
          <video
            ref={videoRef}
            playsInline
            muted
            className="mx-auto mt-4 aspect-square w-56 rounded-2xl border border-white/10 object-cover"
          />
        </>
      )}

      {mode === "manual" && (
        <>
          <h3 className="text-lg font-semibold text-white">Enter the code</h3>
          <p className="mt-2 text-sm text-slate-400">
            No camera available — type this code to confirm you&apos;re awake.
          </p>
          <p className="mt-4 select-none rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-3xl font-bold tracking-[0.4em] text-amber-200">
            {code}
          </p>
          <form onSubmit={submitManual} className="mt-5 flex flex-col gap-3">
            <input
              autoFocus
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError("");
              }}
              className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-center text-xl uppercase tracking-widest text-white outline-none focus:border-amber-400"
              placeholder="Code"
            />
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <button
              type="submit"
              className="rounded-xl bg-amber-500 px-6 py-3 font-semibold text-white transition hover:bg-amber-400"
            >
              Confirm
            </button>
          </form>
        </>
      )}

      {mode === "loading" && (
        <p className="mt-4 text-sm text-slate-400">Starting camera…</p>
      )}
    </div>
  );
}