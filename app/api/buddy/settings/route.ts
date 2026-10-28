import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { ALERT_AFTER_MAX, ALERT_AFTER_MIN, normalizePhone } from "@/lib/buddy";
import { contactFor, settingsFor } from "@/lib/buddyServer";
import { isE164 } from "@/lib/sms";
import { User } from "@/models/User";

interface SettingsBody {
  alertAfterMinutes?: unknown;
  ordinaryAlarms?: unknown;
  /** A number, or null to remove it. */
  phone?: unknown;
  sharePhone?: unknown;
  /** { name, phone, consent: true } to set, null to remove (3.3). */
  emergencyContact?: unknown;
}

/**
 * How long after an alarm your buddy is told, whether ordinary alarms count
 * (off unless turned on), and the number their call button dials, shared only
 * with sharePhone. Only the fields given change.
 */
export async function PUT(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const body = await parseJson<SettingsBody>(req);
    if (!body) {
      return jsonError("A JSON object is required", 422);
    }
    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};
    if (body.alertAfterMinutes !== undefined) {
      const m = body.alertAfterMinutes;
      if (typeof m !== "number" || !Number.isInteger(m) || m < ALERT_AFTER_MIN || m > ALERT_AFTER_MAX) {
        return jsonError(`alertAfterMinutes must be a whole number from ${ALERT_AFTER_MIN} to ${ALERT_AFTER_MAX}`, 422);
      }
      set["preferences.buddy.alertAfterMinutes"] = m;
    }
    for (const key of ["ordinaryAlarms", "sharePhone"] as const) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== "boolean") {
          return jsonError(`${key} must be true or false`, 422);
        }
        set[`preferences.buddy.${key}`] = body[key];
      }
    }
    if (body.phone !== undefined) {
      if (body.phone === null || body.phone === "") {
        unset["preferences.buddy.phone"] = "";
        // No number, nothing to share.
        set["preferences.buddy.sharePhone"] = false;
      }
      else {
        const phone = normalizePhone(body.phone);
        if (!phone) {
          return jsonError("That doesn't look like a phone number: digits, optionally starting with +", 422);
        }
        set["preferences.buddy.phone"] = phone;
      }
    }
    if (body.emergencyContact !== undefined) {
      const c = body.emergencyContact as { name?: unknown; phone?: unknown; consent?: unknown } | null;
      if (c === null) {
        unset["preferences.emergencyContact"] = "";
      }
      else {
        const name = typeof c?.name === "string" ? c.name.trim() : "";
        const phone = typeof c?.phone === "string" ? c.phone.replace(/[\s().-]/g, "") : "";
        if (!name || name.length > 60) {
          return jsonError("emergencyContact.name is required (up to 60 characters)", 422);
        }
        if (!isE164(phone)) {
          return jsonError("emergencyContact.phone must be in international format: + and the country code, e.g. +919876543210", 422);
        }
        if (c?.consent !== true) {
          return jsonError("Confirm that they agreed to get these texts (emergencyContact.consent: true)", 422);
        }
        set["preferences.emergencyContact"] = { name, channel: "sms", value: phone, consentAt: new Date() };
      }
    }
    const current = await settingsFor(userId);
    const willHavePhone = "preferences.buddy.phone" in set || (current.phone !== null && !("preferences.buddy.phone" in unset));
    if (set["preferences.buddy.sharePhone"] === true && !willHavePhone) {
      return jsonError("Add your phone number before sharing it", 422);
    }
    const update: Record<string, unknown> = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (Object.keys(update).length) {
      await User.updateOne({ _id: userId }, update);
    }
    return jsonOk({ ...(await settingsFor(userId)), emergencyContact: await contactFor(userId) });
  });
}
