import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv() {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file))
    return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#"))
      continue;
    const eq = line.indexOf("=");
    if (eq === -1)
      continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env))
      process.env[key] = val;
  }
}

loadEnv();

const MONGO_DB_URI = process.env.MONGO_DB_URI;
if (!MONGO_DB_URI) {
  console.error("X MONGO_DB_URI is not set. Copy .env.local.example -> .env.local first.");
  process.exit(1);
}

const DEMO_EMAIL = "demo@somniai.app";
const DEMO_PASSWORD = "demo1234";

const M = (name, fields, opts = { timestamps: true, strict: false }) => mongoose.models[name] || mongoose.model(name, new mongoose.Schema(fields, opts));
const User = M("User", { email: String });
const Task = M("Task", { userId: String });
const Alarm = M("Alarm", { userId: String });
const SleepLog = M("SleepLog", { userId: String, date: String });
const BehaviorEvent = M("BehaviorEvent", { userId: String }, { strict: false });

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_DB_URI);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await User.findOneAndUpdate({ email: DEMO_EMAIL }, {
    $set: {
      email: DEMO_EMAIL,
      name: "Demo Sleeper",
      passwordHash,
      provider: "credentials",
      timezone: "UTC",
      chronotype: "intermediate",
      sleepGoalHours: 8,
      preferredWakeWindowMin: 30,
      preferences: {
        defaultWakeStrategy: "adaptive",
        verificationRequired: true,
      },
    },
  }, { upsert: true, new: true, setDefaultsOnInsert: true });

  const userId = String(user._id);
  console.log(`Demo user: ${DEMO_EMAIL} (${userId})`);

  await Promise.all([
    Task.deleteMany({ userId }),
    Alarm.deleteMany({ userId }),
    SleepLog.deleteMany({ userId }),
    BehaviorEvent.deleteMany({ userId }),
  ]);

  const now = new Date();
  const sleepLogs = [];
  const events = [];

  for (let i = 14; i >= 1; i--) {
    const night = new Date(now);
    night.setDate(now.getDate() - i);
    const rough = i % 5 === 0;

    const bed = new Date(night);
    bed.setHours(23, Math.round((Math.sin(i) + 1) * 20), 0, 0);

    const wake = new Date(night);
    wake.setDate(wake.getDate() + 1);
    wake.setHours(rough ? 7 : 6, rough ? 40 : 45 + (i % 3) * 5, 0, 0);

    const durationHours = Math.round(((wake - bed) / 3600000 + Number.EPSILON) * 10) / 10;
    const snoozeCount = rough ? 3 : i % 3;

    sleepLogs.push({
      userId,
      date: ymd(night),
      sleepTime: bed,
      wakeTime: wake,
      durationHours,
      snoozeCount,
      alarmResponseMs: 4000 + snoozeCount * 2500,
      wakeConfidence: rough ? 62 : 84 + (i % 3) * 3,
      qualityScore: rough ? 58 : 78 + (i % 4) * 4,
      source: "sensor",
    });

    events.push({ userId, type: "alarm_fire", at: wake }, { userId, type: snoozeCount > 0 ? "snooze" : "dismiss", value: snoozeCount, at: wake }, { userId, type: "verify_pass", value: rough ? 62 : 88, at: wake });
  }

  await SleepLog.insertMany(sleepLogs);
  await BehaviorEvent.insertMany(events);
  console.log(`Inserted ${sleepLogs.length} sleep logs + ${events.length} behavior events.`);

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const tasks = [
    {
      userId,
      title: "Final exam - Algorithms",
      description: "Must not miss the 9am final exam tomorrow.",
      dueDate: ymd(tomorrow),
      dueTime: "09:00",
      category: "Study",
      priority: "critical",
      aiPriority: "critical",
      importanceScore: 94,
      intent: "must-not-miss",
      emotion: "stress",
      stressScore: 78,
      completed: false,
    },
    {
      userId,
      title: "Morning gym session",
      description: "Leg day before work.",
      dueDate: ymd(tomorrow),
      dueTime: "07:00",
      category: "Health",
      priority: "medium",
      completed: false,
    },
    {
      userId,
      title: "Call dentist",
      description: "Reschedule cleaning.",
      category: "Personal",
      priority: "low",
      completed: true,
      completedAt: new Date(now.getTime() - 2 * 86400000),
    },
  ];

  await Task.insertMany(tasks);
  console.log(`Inserted ${tasks.length} tasks.`);

  const examAlarm = new Date(tomorrow);
  examAlarm.setHours(7, 30, 0, 0);

  const soon = new Date(now.getTime() + 2 * 60000);

  const alarms = [
    {
      userId,
      label: "Wake for final exam",
      scheduledTime: examAlarm,
      source: "autonomous",
      repeat: { type: "none" },
      intensity: 85,
      wakeStrategy: "aggressive",
      verificationRequired: true,
      verificationMethod: "math",
      verificationMethods: ["math"],
      minConfidence: 80,
      status: "scheduled",
      enabled: true,
      lastSnoozeCount: 0,
      decision: {
        summary: "Aggressive wake, 90 min before a critical exam",
        rationale: "Linked task 'Final exam - Algorithms' is critical (importance 94) with stress detected, so SomniAI scheduled an early, aggressive wake with math verification.",
        attributions: [
          { feature: "Task importance", value: "critical (94)", impact: "increase", weight: 0.9 },
          { feature: "Detected emotion", value: "stress", impact: "increase", weight: 0.5 },
          { feature: "Sleep debt", value: "low", impact: "neutral", weight: 0.2 },
        ],
        confidence: 0.86,
        decidedBy: "scheduler",
        at: now,
      },
    },
    {
      userId,
      label: "Demo alarm (rings shortly)",
      scheduledTime: soon,
      source: "manual",
      repeat: { type: "none" },
      intensity: 60,
      wakeStrategy: "adaptive",
      verificationRequired: true,
      verificationMethod: "math",
      verificationMethods: ["math"],
      minConfidence: 70,
      status: "scheduled",
      enabled: true,
      lastSnoozeCount: 0,
    },
    {
      userId,
      label: "Weekday work alarm",
      scheduledTime: (() => {
        const d = new Date(tomorrow);
        d.setHours(6, 45, 0, 0);
        return d;
      })(),
      source: "assisted",
      repeat: { type: "weekdays" },
      intensity: 55,
      wakeStrategy: "gentle",
      verificationRequired: false,
      verificationMethod: "none",
      verificationMethods: [],
      minConfidence: 60,
      status: "scheduled",
      enabled: true,
      lastSnoozeCount: 0,
    },
  ];

  await Alarm.insertMany(alarms);
  console.log(`Inserted ${alarms.length} alarms.`);

  await mongoose.disconnect();
  console.log("\n✓ Seed complete.");
  console.log(`  Sign in with:`);
  console.log(`    email:    ${DEMO_EMAIL}`);
  console.log(`    password: ${DEMO_PASSWORD}`);
}

main().catch(async (err) => {
  console.error("X Seed failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});