import { NextRequest, NextResponse } from "next/server";
export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}
export function jsonError(message: string, status: number = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
export async function parseJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as T;
  }
  catch {
    return null;
  }
}

interface ValidatorProps {
  maxlength?: number;
  minlength?: number;
  max?: number;
  min?: number;
}
interface FieldError {
  message?: string;
  kind?: string;
  path?: string;
  properties?: ValidatorProps;
}
interface MongoLikeError {
  name?: string;
  code?: number;
  message?: string;
  errors?: Record<string, FieldError>;
  path?: string;
}

/** "screenMinutesBeforeBed" -> "Screen minutes before bed" */
function humanize(field: string): string {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[._]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Turn a Mongoose ValidationError into something worth showing a person.
 *
 * The driver's own text embeds the rejected value and the internal path
 * ("Path `title` (`aaaa...`, length 300) is longer than..."), which is noise to
 * a user and leaks schema internals to a caller.
 */
function firstValidationMessage(err: MongoLikeError): string | null {
  const [field] = err.errors ? Object.values(err.errors) : [];
  if (!field) {
    return null;
  }
  const name = humanize(field.path ?? "field");
  const p = field.properties ?? {};

  switch (field.kind) {
    case "maxlength":
      return `${name} must be ${p.maxlength} characters or fewer`;
    case "minlength":
      return `${name} must be at least ${p.minlength} characters`;
    case "max":
      return `${name} must be ${p.max} or less`;
    case "min":
      return `${name} must be ${p.min} or more`;
    case "required":
      return `${name} is required`;
    case "enum":
      return `${name} is not one of the allowed values`;
    default:
      return `${name} is invalid`;
  }
}

/**
 * Map a thrown persistence error onto a typed HTTP response.
 *
 * Without this, a schema constraint (a title past `maxlength`, an out-of-range
 * intensity) escapes the route as an unhandled 500 with an empty body, and a
 * database outage hangs for the full server-selection timeout before doing the
 * same. Both are user input or operational states, not programming errors, so
 * they get 422 and 503 respectively.
 */
export function routeError(err: unknown) {
  const e = (err ?? {}) as MongoLikeError;
  const name = e.name ?? "";

  if (name === "ValidationError") {
    return jsonError(firstValidationMessage(e) ?? "Some fields are invalid", 422);
  }
  if (name === "CastError") {
    return jsonError(`Invalid value for "${e.path ?? "field"}"`, 400);
  }
  if (e.code === 11000) {
    return jsonError("That record already exists", 409);
  }
  // Connection-level failures: Mongo is unreachable, not the caller's fault.
  // The driver and the ODM use different prefixes for the same conditions
  // (MongoServerSelectionError vs MongooseServerSelectionError), so match the
  // family rather than an exhaustive list of exact names.
  const isConnectionFailure =
    /^Mongoo?se?(ServerSelection|Network|NotConnected|Timeout|Topology)/.test(name) ||
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|server selection|topology was destroyed|buffering timed out/i.test(
      e.message ?? "",
    );
  if (isConnectionFailure) {
    return jsonError("The database is unavailable. Please try again shortly.", 503);
  }

  console.error("[route] unhandled error:", err);
  return jsonError("Something went wrong on our end", 500);
}

/** Run a route body, converting any thrown persistence error into a typed response. */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  }
  catch (err) {
    return routeError(err);
  }
}