import { Schema, model, models } from "mongoose";
export type Priority = "low" | "medium" | "high" | "critical";
export interface TaskDocument {
  userId: string;
  title: string;
  description?: string;
  dueDate?: string;
  dueTime?: string;
  /** Words the due date was read from, when it came from the title not the picker. */
  dueFromText?: string;
  category?: string;
  priority: Priority;
  aiPriority?: Priority;
  importanceScore?: number;
  stressScore?: number;
  intent?: string;
  emotion?: string;
  completed: boolean;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
const TaskSchema = new Schema<TaskDocument>({
  userId: { type: String, required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 2000 },
  dueDate: { type: String },
  dueTime: { type: String },
  dueFromText: { type: String, maxlength: 60 },
  category: { type: String, default: "Personal" },
  priority: {
    type: String,
    enum: ["low", "medium", "high", "critical"],
    default: "medium",
  },
  aiPriority: { type: String, enum: ["low", "medium", "high", "critical"] },
  importanceScore: { type: Number },
  stressScore: { type: Number },
  intent: { type: String },
  emotion: { type: String },
  completed: { type: Boolean, default: false, index: true },
  completedAt: { type: Date },
}, { timestamps: true });
TaskSchema.index({ title: "text", description: "text", category: "text" });
export const Task = models.Task || model<TaskDocument>("Task", TaskSchema);