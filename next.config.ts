import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * Page and route file extensions. Only `next dev` also takes "*.dev.tsx" /
 * "*.dev.ts": the developer simulator (app/simulator/page.dev.tsx) and its
 * API (route.dev.ts files under app/api/dev) exist there and nowhere else, so a
 * production build has neither the routes nor the simulators they import
 * (prompt 4.4; `npm run verify` checks the built routes).
 */
export function pageExtensions(phase: string): string[] {
  const real = ["tsx", "ts", "jsx", "js"];
  return phase === PHASE_DEVELOPMENT_SERVER ? ["dev.tsx", "dev.ts", ...real] : real;
}
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), accelerometer=(self), gyroscope=(self)",
  }
];
const base: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
};
export default function nextConfig(phase: string): NextConfig {
  return { ...base, pageExtensions: pageExtensions(phase) };
}