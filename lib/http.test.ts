import { describe, expect, it } from "vitest";
import { routeError } from "./http";

const named = (name: string, message = "") => Object.assign(new Error(message), { name });

describe("routeError: an unreachable database is a 503, from either library", () => {
  it.each([
    "MongoNotConnectedError",
    "MongoServerSelectionError",
    "MongoNetworkError",
    "MongoNetworkTimeoutError",
    "MongoTopologyClosedError",
    "MongooseServerSelectionError",
    "MongooseTimeoutError",
  ])("%s", async (name) => {
    const res = routeError(named(name, "something about the connection"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "The database is unavailable. Please try again shortly." });
  });

  it("recognises a refused connection by its message", () => {
    expect(routeError(named("Error", "connect ECONNREFUSED 127.0.0.1:27017")).status).toBe(503);
  });

  it("does not call a programming error an outage", () => {
    expect(routeError(new TypeError("x is undefined")).status).toBe(500);
  });
});
