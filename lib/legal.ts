// The privacy policy, terms and how to delete an account (legal/*.md, prompt 7.2), with the facts only a
// deployment knows filled in from its environment: who runs it, how to reach
// them, where it is hosted, how long backups are kept, and whose law applies.
// The repository stays anonymous (CLAUDE.md, rule 1), so these are never in a
// tracked file; a deployment that hasn't set one shows "[not set: NAME]" in the
// text, and the page says so at the top rather than publish a policy with a gap
// nobody notices.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PLACEHOLDERS = {
  OPERATOR: "SOMNIAI_OPERATOR",
  CONTACT: "SOMNIAI_CONTACT",
  HOSTING: "SOMNIAI_HOSTING",
  BACKUPS: "SOMNIAI_BACKUPS",
  JURISDICTION: "SOMNIAI_JURISDICTION",
} as const;

export type LegalDoc = "PRIVACY" | "TERMS" | "DELETE_ACCOUNT";

export interface Filled {
  markdown: string;
  /** Environment variables the text needed and this deployment hasn't set. */
  missing: string[];
}

export function fill(markdown: string, env: Record<string, string | undefined>): Filled {
  const missing = new Set<string>();
  const out = markdown.replace(/\{\{([A-Z_]+)\}\}/g, (whole, name: string) => {
    const variable = PLACEHOLDERS[name as keyof typeof PLACEHOLDERS];
    if (!variable) {
      throw new Error(`legal text has an unknown placeholder ${whole}`);
    }
    const value = env[variable]?.trim();
    if (!value) {
      missing.add(variable);
      return `[not set: ${variable}]`;
    }
    return value;
  });
  return { markdown: out, missing: [...missing] };
}

export function readLegal(doc: LegalDoc): string {
  return readFileSync(join(process.cwd(), "legal", `${doc}.md`), "utf8");
}

export function legalText(doc: LegalDoc, env: Record<string, string | undefined> = process.env): Filled {
  return fill(readLegal(doc), env);
}
