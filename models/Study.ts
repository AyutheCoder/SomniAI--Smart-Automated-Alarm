import { Schema, model, models } from "mongoose";
import type { Experiment } from "@/lib/randomisation";

/**
 * Study mode (prompt 6.2). A study: which aspect it randomises, the seed every
 * participant's assignments come from, and how many have withdrawn (all that
 * remains of them).
 */
export interface StudyDocument {
  studyId: string;
  experiment: Experiment;
  seed: string;
  withdrawn: number;
  createdAt: Date;
}

const StudySchema = new Schema<StudyDocument>({
  studyId: { type: String, required: true, unique: true },
  experiment: { type: String, enum: ["escalation_pacing", "wake_plan"], required: true },
  seed: { type: String, required: true },
  withdrawn: { type: Number, required: true, default: 0 },
  createdAt: { type: Date, required: true },
});

export const Study = models.Study || model<StudyDocument>("Study", StudySchema);

/** An enrolment code, stored only as its SHA-256: a copy of the database doesn't reveal working codes. */
export interface StudyCodeDocument {
  studyId: string;
  codeHash: string;
  uses: number;
  maxUses: number;
  expiresAt: Date | null;
  createdAt: Date;
}

const StudyCodeSchema = new Schema<StudyCodeDocument>({
  studyId: { type: String, required: true },
  codeHash: { type: String, required: true, unique: true },
  uses: { type: Number, required: true, default: 0, min: 0 },
  maxUses: { type: Number, required: true, min: 1 },
  expiresAt: { type: Date, default: null },
  createdAt: { type: Date, required: true },
});

export const StudyCode = models.StudyCode || model<StudyCodeDocument>("StudyCode", StudyCodeSchema);

/**
 * A participant: the link between the account and the random participant
 * code exports use. Deleted on withdrawal, which breaks that link for good.
 */
export interface EnrollmentDocument {
  userId: string;
  studyId: string;
  participantId: string;
  consentVersion: string;
  consentedAt: Date;
  /** The participant's timezone, for local times of day in the export. */
  tz: string;
}

const EnrollmentSchema = new Schema<EnrollmentDocument>({
  userId: { type: String, required: true, unique: true },
  studyId: { type: String, required: true, index: true },
  participantId: { type: String, required: true, unique: true },
  consentVersion: { type: String, required: true },
  consentedAt: { type: Date, required: true },
  tz: { type: String, required: true },
});

export const Enrollment = models.Enrollment || model<EnrollmentDocument>("Enrollment", EnrollmentSchema);
