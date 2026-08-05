import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/app/_components/Providers";
import { ServiceWorkerRegister } from "@/app/_components/ServiceWorkerRegister";

export const metadata: Metadata = {
  applicationName: "SomniAI",
  title: {
    default: "SomniAI - Adaptive Circadian Intelligence",
    template: "%s - SomniAI",
  },
  description: "An autonomous AI sleep/wake optimization platform: adaptive alarms, wake verification, and behavioral wellness coaching.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SomniAI",
  },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/icon.svg" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0b1020",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Providers>
          <div id="main-content">{children}</div>
        </Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}