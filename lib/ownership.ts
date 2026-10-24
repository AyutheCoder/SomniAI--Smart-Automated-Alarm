import mongoose from "mongoose";
import { Alarm } from "@/models/Alarm";
import { Task } from "@/models/Task";

/**
 * Checks that a reference a caller supplies points at their own record.
 *
 * Returns an error message for the response, or null when the reference is
 * acceptable. Another user's record and a missing one get the same answer, so
 * the check cannot be used to probe which ids exist.
 */
export async function foreignTaskError(userId: string, taskId: unknown): Promise<string | null> {
  if (typeof taskId !== "string" || !mongoose.Types.ObjectId.isValid(taskId)) {
    return "linkedTaskId is not a valid task id";
  }
  const owned = await Task.exists({ _id: taskId, userId });
  return owned ? null : "The linked task was not found";
}

export async function foreignAlarmError(userId: string, alarmId: unknown): Promise<string | null> {
  if (typeof alarmId !== "string" || !mongoose.Types.ObjectId.isValid(alarmId)) {
    return "alarmId is not a valid alarm id";
  }
  const owned = await Alarm.exists({ _id: alarmId, userId });
  return owned ? null : "The alarm was not found";
}
