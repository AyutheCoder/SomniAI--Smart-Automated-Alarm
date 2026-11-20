// Imported first by setup.ts. ES module imports run before the importing
// module's body, and lib/mongoose and lib/aiClient read their environment
// when they are first imported, so the environment has to be set in a module
// of its own that loads ahead of everything else.
import { randomUUID } from "node:crypto";
import { inject } from "vitest";

// A database of this file's own on the shared in-memory server.
process.env.MONGO_DB_URI = `${inject("mongoUri").replace(/\/?$/, "/")}somniai-test-${randomUUID()}`;
// No AI Brain: routes must use their local fallbacks, and tests never touch
// the network. A test that needs the Brain stubs fetch itself.
delete process.env.AI_BRAIN_URL;
// The connection cache lives on globalThis and would otherwise outlive a file.
globalThis._mongooseCache = undefined;
