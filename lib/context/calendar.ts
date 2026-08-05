import type { CalendarEvent } from "./types";

const SAMPLE_EVENTS: Array<{
  title: string;
  importanceScore: number;
  hour: number;
}> = [
  { title: "Final exam", importanceScore: 95, hour: 9 },
  { title: "Job interview", importanceScore: 90, hour: 10 },
  { title: "Flight departure", importanceScore: 88, hour: 7 },
  { title: "Team standup", importanceScore: 55, hour: 9 },
  { title: "Doctor appointment", importanceScore: 70, hour: 11 },
  { title: "Gym session", importanceScore: 30, hour: 6 },
  { title: "Project deadline", importanceScore: 85, hour: 17 },
  { title: "Coffee with a friend", importanceScore: 20, hour: 15 },
];

export function simulateCalendar(from: Date = new Date()): CalendarEvent[] {
  const picks = [...SAMPLE_EVENTS]
    .sort(() => Math.random() - 0.5)
    .slice(0, 3 + Math.floor(Math.random() * 2));
  return picks
    .map((e, i) => {
      const start = new Date(from);
      start.setDate(start.getDate() + i + 1);
      start.setHours(e.hour, 0, 0, 0);
      return {
        title: e.title,
        start: start.toISOString(),
        importanceScore: e.importanceScore,
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}