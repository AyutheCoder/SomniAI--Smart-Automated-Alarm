import type { Metadata } from "next";
import LegalPage from "@/app/_components/LegalPage";
import { legalText } from "@/lib/legal";

export const metadata: Metadata = { title: "Delete your account" };
// Google Play's account-deletion link (7.2): reachable signed out, and without the app.
export const dynamic = "force-static";

export default function DeleteAccountPage() {
  const { markdown, missing } = legalText("DELETE_ACCOUNT");
  return <LegalPage source={markdown} missing={missing} />;
}
