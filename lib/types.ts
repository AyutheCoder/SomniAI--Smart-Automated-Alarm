export const LOCAL_USER_ID = "local-user";
export type Priority = "low" | "medium" | "high" | "critical";
export type WakeStrategy = "gentle" | "adaptive" | "aggressive";
export interface Task {
  _id: string;
  userId: string;
  title: string;
  description?: string;
  dueDate?: string;
  dueTime?: string;
  category?: string;
  priority: Priority;
  aiPriority?: Priority;
  importanceScore?: number;
  stressScore?: number;
  intent?: "must-not-miss" | "routine" | "casual" | "procrastination-risk";
  emotion?: "stress" | "fatigue" | "motivation" | "calm" | "neutral";
  completed: boolean;
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}
export type AlarmStatus = "scheduled" | "ringing" | "snoozed" | "dismissed" | "verified" | "missed" | "completed";
export interface Alarm {
  _id: string;
  userId: string;
  label: string;
  scheduledTime: string;
  source: "manual" | "assisted" | "autonomous";
  linkedTaskId?: string;
  repeat: {
    type: "none" | "daily" | "weekdays" | "custom";
    days?: number[];
  };
  intensity: number;
  wakeStrategy: WakeStrategy;
  verificationRequired: boolean;
  verificationMethod: "math" | "typing" | "tap" | "none";
  verificationMethods?: string[];
  minConfidence: number;
  status: AlarmStatus;
  enabled: boolean;
  lastSnoozeCount: number;
  decision?: AlarmDecision;
  createdAt: string;
  updatedAt: string;
}
export interface AlarmDecision {
  summary: string;
  rationale: string;
  attributions: {
    feature: string;
    value: string;
    impact: "increase" | "decrease" | "neutral";
    weight: number;
    detail?: string;
  }[];
  confidence?: number;
  decidedBy?: "scheduler" | "rl" | "lifecycle" | "user";
  at?: string;
}