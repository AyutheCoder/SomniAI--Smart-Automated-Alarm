import mongoose from "mongoose";
const MONGO_URI = process.env.MONGO_DB_URI || "";
type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};
declare global {
  var _mongooseCache: MongooseCache | undefined;
}
const cached: MongooseCache = global._mongooseCache || {
  conn: null,
  promise: null,
};
export async function connectToDatabase(): Promise<typeof mongoose> {
  if (!MONGO_URI) {
    throw new Error("Missing MONGO_DB_URI environment variable. Copy .env.local.example to .env.local and set it.");
  }
  if (cached.conn) {
    return cached.conn;
  }
  if (!cached.promise) {
    // The driver's 30s default means a request sits open for half a minute
    // before anyone learns the database is down. Fail fast instead, so the
    // route can return a 503 while the page is still worth rendering.
    cached.promise = mongoose
      .connect(MONGO_URI, {
        serverSelectionTimeoutMS: 4000,
        connectTimeoutMS: 4000,
        socketTimeoutMS: 20000,
      })
      .then((m) => m)
      .catch((err) => {
        // Drop the rejected promise so the next request retries rather than
        // re-awaiting a permanently failed connection attempt.
        cached.promise = null;
        throw err;
      });
  }
  cached.conn = await cached.promise;
  global._mongooseCache = cached;
  return cached.conn;
}