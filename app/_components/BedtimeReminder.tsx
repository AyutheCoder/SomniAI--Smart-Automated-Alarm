"use client";

import { useEffect, useState } from "react";
import { Moon } from "lucide-react";
import { clockTime, loadReminder, reminderDue, saveReminder, type BedtimeReminder as Reminder } from "@/lib/bedtime";
import { notify } from "@/lib/clientAlarm";
import { browserStore } from "@/lib/outbox";
import { REMINDER_CHANGED } from "./WakePlanPanel";

/**
 * Shows the bedtime reminder when its time comes: a web notification, and a
 * banner on the page in case notifications are off. Web only for now, so only
 * while a SomniAI tab is open; Phase 2 makes it native.
 */
export default function BedtimeReminder({ userId }: { userId: string | null }) {
  const [shown, setShown] = useState<Reminder | null>(null);

  useEffect(() => {
    if (!userId) {
      return;
    }
    const check = () => {
      const store = browserStore();
      const reminder = loadReminder(store, userId);
      if (reminder && reminderDue(reminder, new Date())) {
        const done = { ...reminder, shownAt: new Date().toISOString() };
        saveReminder(store, userId, done);
        void notify("Time for bed", `Asleep by ${clockTime(new Date(reminder.at))} for your ${clockTime(new Date(reminder.wakeAt))} wake.`);
        setShown(done);
      }
    };
    check();
    const timer = setInterval(check, 15_000);
    window.addEventListener(REMINDER_CHANGED, check);
    return () => {
      clearInterval(timer);
      window.removeEventListener(REMINDER_CHANGED, check);
    };
  }, [userId]);

  if (!shown) {
    return null;
  }
  return (
    <div role="alert" aria-label="Bedtime reminder" className="mb-6 flex items-center gap-3 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100">
      <Moon className="h-4 w-4 flex-none" />
      <span>
        Time for bed: asleep by {clockTime(new Date(shown.at))} for your {clockTime(new Date(shown.wakeAt))} wake.
      </span>
      <button type="button" onClick={() => setShown(null)} className="ml-auto rounded-lg border border-indigo-300/30 px-2.5 py-1 text-xs hover:bg-indigo-500/20">
        OK
      </button>
    </div>
  );
}
