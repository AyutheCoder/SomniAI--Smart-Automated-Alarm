import type { Metadata } from "next";
import LegalPage from "@/app/_components/LegalPage";
import { legalText } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy policy" };
// Built once from legal/PRIVACY.md and this deployment's settings (lib/legal.ts).
export const dynamic = "force-static";

export default function PrivacyPage() {
  const { markdown, missing } = legalText("PRIVACY");
  return <LegalPage source={markdown} missing={missing} />;
}
