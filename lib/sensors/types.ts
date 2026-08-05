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

export interface SensorAdapter<T> {
    readonly kind: SensorKind;
    readonly supported: boolean;
    readonly simulated: boolean;
    start(onSample: (sample: T) => void): Promise<void> | void;
    stop(): void;
    isRunning(): boolean;
}