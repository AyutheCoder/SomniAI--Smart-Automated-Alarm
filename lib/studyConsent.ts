// The study's consent document (prompt 6.2), versioned. A participant agrees
// to one version; that version is stored with their enrolment and in every
// export. Changing what the study does or collects is a new version, which
// enrolled participants would have to agree to again. The pre-registration
// (study/PREREGISTRATION.md) refers to this version.

export const STUDY_ID = "somni-wake-plan-1";

export interface ConsentSection {
  heading: string;
  text: string[];
}

export interface ConsentDocument {
  version: string;
  studyId: string;
  title: string;
  sections: ConsentSection[];
}

export const STUDY_CONSENT: ConsentDocument = {
  version: "study-v1",
  studyId: STUDY_ID,
  title: "Does seeing a wake plan help people wake on time?",
  sections: [
    {
      heading: "What the study asks",
      text: [
        "Whether being shown a wake plan (the latest bedtime that still gets you up) the evening before an alarm "
        + "helps you wake close to your usual time.",
        "It runs for 6 weeks. You use SomniAI as you normally would.",
      ],
    },
    {
      heading: "What changes for you",
      text: [
        "Each alarm you set is assigned at random to \"plan shown\" or \"plan not shown\". For a \"not shown\" alarm, "
        + "SomniAI won't give a wake plan for that alarm's time, and says it's because of the study.",
        "Your alarms ring exactly as they would otherwise. An alarm marked unmissable is never part of the study.",
      ],
    },
    {
      heading: "What is collected",
      text: [
        "Which arm each alarm was assigned to.",
        "Your sleep log: when you slept and woke, and for how long.",
        "Alarm telemetry, which joining turns on: how long until you first touched the screen when an alarm rang, "
        + "how many times you snoozed, how far it escalated, and how the wake check went.",
        "Nothing about where you are, your messages, your contacts, or anything outside SomniAI.",
      ],
    },
    {
      heading: "How it is kept",
      text: [
        "The researchers receive only an anonymised export: a random participant code, study days instead of dates, "
        + "times of day, and the measurements above. Never your name, email address, account, or alarm names.",
      ],
    },
    {
      heading: "Leaving",
      text: [
        "You can leave at any time, without giving a reason, from this screen. Leaving deletes everything collected for "
        + "the study, removes you from all future exports, turns telemetry off, and stops the random assignments. Your "
        + "own alarms and sleep log stay in your account as before.",
        "An export a researcher already took before you left can't be recalled, but it never contained your name or email.",
      ],
    },
    {
      heading: "Taking part is voluntary",
      text: [
        "Not joining, or leaving, changes nothing else about SomniAI.",
        "The study only starts enrolling after an ethics committee has approved it.",
      ],
    },
  ],
};

/** The whole document as plain text, for a check that nothing promised is missing. */
export function consentText(doc: ConsentDocument = STUDY_CONSENT): string {
  return [doc.title, ...doc.sections.flatMap((s) => [s.heading, ...s.text])].join("\n");
}
