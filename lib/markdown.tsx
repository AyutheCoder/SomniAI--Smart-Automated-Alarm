// A small Markdown renderer for the legal pages (7.2): headings, paragraphs,
// bullet lists, **bold**, *italic*, `code` and [links](...). It builds React
// elements, never HTML strings, so nothing in a document can inject markup,
// and a link goes only to http(s), mailto, or a path on this site.

import type { ReactNode } from "react";

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:|\/(?![/\\])|#)/i.test(href) ? href : null;
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

export function inline(text: string, key = "i"): ReactNode[] {
  return text.split(INLINE).filter((p) => p !== "").map((part, i) => {
    const k = `${key}-${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={k} className="font-semibold text-white">{inline(part.slice(2, -2), k)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={k} className="rounded bg-white/10 px-1 text-[0.9em]">{part.slice(1, -1)}</code>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const href = safeHref(link[2]);
      return href
        ? <a key={k} href={href} className="text-indigo-300 underline hover:text-indigo-200">{inline(link[1], k)}</a>
        : <span key={k}>{link[1]}</span>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={k}>{inline(part.slice(1, -1), k)}</em>;
    }
    return part;
  });
}

type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] };

export function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (para.length) {
      out.push({ kind: "p", text: para.join(" ") });
      para = [];
    }
    if (list) {
      out.push({ kind: "ul", items: list });
      list = null;
    }
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flush();
      out.push({ kind: "h", level: h[1].length as 1 | 2 | 3, text: h[2] });
    }
    else if (/^\s*-\s+/.test(line)) {
      if (para.length) {
        flush();
      }
      (list ??= []).push(line.replace(/^\s*-\s+/, ""));
    }
    else if (line.trim() === "") {
      flush();
    }
    else if (list && /^\s{2,}\S/.test(raw)) {
      list[list.length - 1] += ` ${line.trim()}`;
    }
    else {
      if (list) {
        flush();
      }
      para.push(line.trim());
    }
  }
  flush();
  return out;
}

const HEADING = {
  1: "mb-2 text-2xl font-semibold text-white",
  2: "mb-3 mt-8 text-xl font-semibold text-white",
  3: "mb-2 mt-6 text-base font-semibold text-white",
} as const;

export function Markdown({ source }: { source: string }) {
  return (
    <>
      {blocks(source).map((b, i) => {
        if (b.kind === "h") {
          const Tag = (`h${b.level}`) as "h1" | "h2" | "h3";
          return <Tag key={i} id={slug(b.text)} className={HEADING[b.level]}>{inline(b.text, `h${i}`)}</Tag>;
        }
        if (b.kind === "ul") {
          return (
            <ul key={i} className="mb-4 list-disc space-y-1.5 pl-5">
              {b.items.map((it, j) => <li key={j}>{inline(it, `l${i}-${j}`)}</li>)}
            </ul>
          );
        }
        return <p key={i} className="mb-4">{inline(b.text, `p${i}`)}</p>;
      })}
    </>
  );
}
