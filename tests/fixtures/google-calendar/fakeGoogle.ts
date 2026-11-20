// A stand-in for Google that answers from the fixtures in this folder, and
// records what it was asked. Nothing here reaches the network.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fetch } from "@/lib/googleCalendar";

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, `${name}.json`), "utf8"));
}

type Reply = { status: number; fixture: string } | Error;

export interface FakeGoogle {
  fetch: Fetch;
  calls: { url: string; method: string; body?: string; authorization?: string }[];
}

/**
 * `token`: replies to POST /token, in order (the last repeats).
 * `events`: replies to events.list, in order (the last repeats).
 * `revoke`: the status POST /revoke answers with.
 */
export function fakeGoogle(opts: { token?: Reply[]; events?: Reply[]; revoke?: number }): FakeGoogle {
  const calls: FakeGoogle["calls"] = [];
  const queues = { token: [...(opts.token ?? [])], events: [...(opts.events ?? [])] };
  const next = (q: Reply[]): Reply => (q.length > 1 ? q.shift()! : q[0]);
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body, authorization: init?.headers?.authorization });
    let reply: Reply;
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      reply = next(queues.token);
    }
    else if (url.startsWith("https://oauth2.googleapis.com/revoke")) {
      reply = { status: opts.revoke ?? 200, fixture: "" };
    }
    else if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
      reply = next(queues.events);
    }
    else {
      throw new Error(`the fake Google wasn't expecting ${url}`);
    }
    if (reply instanceof Error) {
      throw reply;
    }
    const { status, fixture: name } = reply;
    return { status, json: async () => (name ? fixture(name) : {}) };
  };
  return { fetch, calls };
}
