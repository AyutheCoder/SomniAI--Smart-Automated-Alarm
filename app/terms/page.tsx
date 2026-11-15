import type { Metadata } from "next";
import LegalPage from "@/app/_components/LegalPage";
import { legalText } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of use" };
// Built once from legal/TERMS.md and this deployment's settings (lib/legal.ts).
export const dynamic = "force-static";

export default function TermsPage() {
  const { markdown, missing } = legalText("TERMS");
  return <LegalPage source={markdown} missing={missing} />;
}
