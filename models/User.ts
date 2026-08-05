import { Schema, model, models } from "mongoose";
export type WakeStrategy = "gentle" | "adaptive" | "aggressive";
export type Chronotype = "lark" | "intermediate" | "owl";
export type AuthProvider = "credentials" | "google";
export interface UserDocument {
  email: string;
  name?: string;
  image?: string;
  passwordHash?: string;
  provider: AuthProvider;
  timezone: string;
  chronotype?: Chronotype;
  sleepGoalHours: number;
  preferredWakeWindowMin: number;
  preferences: {
    defaultWakeStrategy: WakeStrategy;
    verificationRequired: boolean;
    emergencyContact?: {
      name: string;
      channel: "email" | "sms";
      value: string;
    };
  };
  createdAt: Date;
  updatedAt: Date;
}
const UserSchema = new Schema<UserDocument>({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  name: { type: String, trim: true, maxlength: 120 },
  image: { type: String },
  passwordHash: { type: String, select: false },
  provider: {
    type: String,
    enum: ["credentials", "google"],
    default: "credentials",
  },
  timezone: { type: String, default: "UTC" },
  chronotype: { type: String, enum: ["lark", "intermediate", "owl"] },
  sleepGoalHours: { type: Number, default: 8, min: 1, max: 14 },
  preferredWakeWindowMin: { type: Number, default: 30, min: 0, max: 120 },
  preferences: {
    defaultWakeStrategy: {
      type: String,
      enum: ["gentle", "adaptive", "aggressive"],
      default: "adaptive",
    },
    verificationRequired: { type: Boolean, default: true },
    emergencyContact: {
      name: { type: String },
      channel: { type: String, enum: ["email", "sms"] },
      value: { type: String },
    },
  },
}, { timestamps: true });
export const User = models.User || model<UserDocument>("User", UserSchema);