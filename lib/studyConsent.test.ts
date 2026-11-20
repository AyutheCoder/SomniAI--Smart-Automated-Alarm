import { describe, expect, it } from "vitest";
// The researchers' code script, plain Node: it must make and hash codes exactly as the server does.
import { hashCode as scriptHash, newCode as scriptNewCode, normaliseCode as scriptNormalise, STUDY_ID as SCRIPT_STUDY } from "../scripts/study-codes.mjs";
import { consentText, STUDY_CONSENT, STUDY_ID } from "./studyConsent";
import { hashCode, normaliseCode } from "./studyServer";

describe("the study's consent document", () => {
  it("is versioned and names its study", () => {
    expect(STUDY_CONSENT).toMatchObject({ version: "study-v1", studyId: "somni-wake-plan-1" });
  });

  it("says what changes, what is and isn't collected, how it's kept, and how to leave", () => {
    const text = consentText();
    for (const must of [
      /assigned at random to "plan shown" or "plan not shown"/,
      /alarms ring exactly as they would otherwise/,
      /unmissable is never part of the study/,
      /Alarm telemetry, which joining turns on/,
      /Nothing about where you are, your messages, your contacts/,
      /study days instead of dates/,
      /Never your name, email address, account, or alarm names/,
      /leave at any time, without giving a reason/,
      /Leaving deletes everything collected for the study/,
      /only starts enrolling after an ethics committee has approved it/,
    ]) {
      expect(text).toMatch(must);
    }
  });
});

describe("enrolment codes", () => {
  it("the researchers' script makes and hashes them exactly as the server does", () => {
    expect(SCRIPT_STUDY).toBe(STUDY_ID);
    for (const code of ["ABCD-EFGH-JKLM", " abcd efgh jklm ", scriptNewCode(), scriptNewCode()]) {
      expect(scriptNormalise(code)).toBe(normaliseCode(code));
      expect(scriptHash(code)).toBe(hashCode(code));
    }
    expect(scriptNewCode()).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  });
});
