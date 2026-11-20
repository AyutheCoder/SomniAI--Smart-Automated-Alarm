export type SensorKind = "motion" | "mic" | "screen";
export interface MotionSample {
    magnitude: number;
    x: number;
    y: number;
    z: number;
    at: number;
}

export interface MicSample {
    rms: number;
    db: number;
    at: number;
}

export type ScreenState = "screen_on" | "screen_off";
export interface ScreenSample {
    state: ScreenState;
    visible: boolean;
    focused: boolean;
    idleMs: number;
    at: number;
}

/**
 * A sensor. The adapters in this folder read real browser sensors only: one
 * that isn't there, or isn't allowed, says so (start() rejects) and never
 * makes readings up. Simulated sensors are the developer simulator's
 * (lib/simulators/sensors.ts), and say so in `simulated`.
 */
export interface SensorAdapter<T> {
    readonly kind: SensorKind;
    readonly supported: boolean;
    readonly simulated: boolean;
    start(onSample: (sample: T) => void): Promise<void> | void;
    stop(): void;
    isRunning(): boolean;
}

/** Why a real sensor couldn't start. */
export class SensorUnavailable extends Error {
    constructor(readonly kind: SensorKind, readonly reason: "unsupported" | "refused", message: string) {
        super(message);
        this.name = "SensorUnavailable";
    }
}
