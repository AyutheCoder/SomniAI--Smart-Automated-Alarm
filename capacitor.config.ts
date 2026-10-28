import type { CapacitorConfig } from "@capacitor/cli";

// The Android shell loads the app from a server rather than from bundled
// files; ANDROID.md explains the decision and its trade-offs.
//
// CAP_SERVER_URL picks the server, read when `npx cap sync` runs:
//   unset              http://10.0.2.2:3000, the emulator's address for this
//                      machine, where `npm run dev` listens
//   CAP_SERVER_URL=... a phone on the same Wi-Fi, or the deployed site
//
// A release build (CAP_RELEASE=1) must use HTTPS: plain HTTP is only for a dev
// server on this machine, and is refused otherwise.
const url = process.env.CAP_SERVER_URL ?? "http://10.0.2.2:3000";
const parsed = new URL(url);
const plainHttp = parsed.protocol === "http:";

if (process.env.CAP_RELEASE === "1" && plainHttp) {
  throw new Error(`CAP_RELEASE=1 needs an https:// CAP_SERVER_URL, not ${url}`);
}

const config: CapacitorConfig = {
  appId: "app.somniai.alarm",
  appName: "SomniAI",
  // Only the offline page lives here; see server.errorPath.
  webDir: "mobile/www",
  server: {
    url,
    cleartext: plainHttp,
    // The web view may only navigate within the app's own server; any other
    // link opens in the browser, outside the app and its native bridge.
    allowNavigation: [parsed.host],
    // Shown when the server can't be reached. It has no access to Capacitor
    // plugins on Android, so it can only explain, not act.
    errorPath: "offline.html",
  },
};

export default config;
