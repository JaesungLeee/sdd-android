import { parse } from "yaml";
import type { Grade } from "./version.js";

export interface BasedOn {
  version: string;
  items?: string[];
}

export interface Revision {
  version: string;
  date: string;
  items?: Record<string, Grade>;
}

export interface Meta {
  /** `draft` 문서에는 두지 않는다. */
  version?: string;
  status?: string;
  based_on?: Record<string, BasedOn>;
  created?: string;
  updated?: string;
  revisions?: Revision[];
}

export interface ParsedDoc {
  hasFrontmatter: boolean;
  meta: Meta;
  body: string;
  /** frontmatter를 읽지 못한 이유. 충돌 표시가 남았거나 YAML이 깨진 경우다. */
  error?: string;
}

const CONFLICT_MARKER = /^(<{7}|={7}|>{7})( |$)/m;

/** 문서를 frontmatter와 본문으로 나눈다. 본문은 해시의 대상이다. */
export function parseDoc(text: string): ParsedDoc {
  const source = text.replace(/\r\n?/g, "\n");
  if (!source.startsWith("---\n")) return { hasFrontmatter: false, meta: {}, body: source };

  const end = source.indexOf("\n---\n", 3);
  const endAtEof = end < 0 && source.endsWith("\n---") ? source.length - 4 : -1;
  const close = end >= 0 ? end : endAtEof;
  if (close < 0) {
    return { hasFrontmatter: true, meta: {}, body: "", error: "frontmatter가 닫히지 않았다" };
  }

  const raw = source.slice(4, close + 1);
  const body = source.slice(close + 5);
  if (CONFLICT_MARKER.test(raw)) {
    return { hasFrontmatter: true, meta: {}, body, error: "frontmatter에 충돌 표시가 남아 있다" };
  }

  try {
    const data: unknown = parse(raw);
    if (data !== null && (typeof data !== "object" || Array.isArray(data))) {
      return { hasFrontmatter: true, meta: {}, body, error: "frontmatter가 키와 값의 묶음이 아니다" };
    }
    return { hasFrontmatter: true, meta: (data ?? {}) as Meta, body };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { hasFrontmatter: true, meta: {}, body, error: `frontmatter를 읽을 수 없다: ${message}` };
  }
}

function quoteKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

/**
 * frontmatter를 고정된 키 순서와 모양으로 적는다.
 * 같은 값이면 언제나 같은 글자가 나와야 병합 충돌과 해시가 흔들리지 않는다.
 */
export function formatMeta(meta: Meta): string {
  const lines: string[] = [];
  if (meta.version !== undefined) lines.push(`version: ${meta.version}`);
  if (meta.status !== undefined) lines.push(`status: ${meta.status}`);
  if (meta.based_on && Object.keys(meta.based_on).length > 0) {
    lines.push("based_on:");
    for (const [name, base] of Object.entries(meta.based_on)) {
      const parts = [`version: ${base.version}`];
      if (base.items) parts.push(`items: [${base.items.join(", ")}]`);
      lines.push(`  ${name}: { ${parts.join(", ")} }`);
    }
  }
  if (meta.created !== undefined) lines.push(`created: ${meta.created}`);
  if (meta.updated !== undefined) lines.push(`updated: ${meta.updated}`);
  if (meta.revisions) {
    lines.push("revisions:");
    for (const revision of meta.revisions) {
      lines.push(`  - version: ${revision.version}`);
      lines.push(`    date: ${revision.date}`);
      if (revision.items) {
        const entries = Object.entries(revision.items).map(([id, grade]) => `${quoteKey(id)}: ${grade}`);
        lines.push(`    items: { ${entries.join(", ")} }`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

export function formatDoc(meta: Meta, body: string): string {
  return `---\n${formatMeta(meta)}---\n${body}`;
}
