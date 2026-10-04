import { createHash } from "node:crypto";
import { splitItems } from "./items.js";
import { normalizeText } from "./normalize.js";

export type DocKind = "constitution" | "prd" | "spec" | "checklist" | "blueprint" | "breakdown";

/** 항목 밖의 부분을 가리키는 이름. */
export const OUTSIDE = "*";
/** 항목이 없는 문서의 본문 전체를 가리키는 이름. */
export const BODY = "body";

export type Hashes = Record<string, string>;

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hasItems(kind: DocKind): boolean {
  return kind === "prd" || kind === "constitution";
}

/** 문서 본문(frontmatter 제외)의 해시를 낸다. prd와 constitution은 항목마다 낸다. */
export function hashBody(kind: DocKind, body: string): Hashes {
  if (!hasItems(kind)) {
    return { [BODY]: sha256(normalizeText(body, { uncheck: kind === "breakdown" })) };
  }
  const split = splitItems(body);
  const hashes: Hashes = { [OUTSIDE]: sha256(normalizeText(split.outside)) };
  for (const [id, text] of split.items) hashes[id] = sha256(normalizeText(text));
  return hashes;
}

export interface HashDiff {
  changed: string[];
  added: string[];
  removed: string[];
}

export function diffHashes(recorded: Hashes, current: Hashes): HashDiff {
  const diff: HashDiff = { changed: [], added: [], removed: [] };
  for (const name of Object.keys(current).sort()) {
    if (!(name in recorded)) diff.added.push(name);
    else if (recorded[name] !== current[name]) diff.changed.push(name);
  }
  for (const name of Object.keys(recorded).sort()) {
    if (!(name in current)) diff.removed.push(name);
  }
  return diff;
}

export function isUnchanged(diff: HashDiff): boolean {
  return diff.changed.length === 0 && diff.added.length === 0 && diff.removed.length === 0;
}

export interface HashFile {
  version?: string;
  hashes: Hashes;
}

const RESERVED_FIRST = [OUTSIDE, BODY];

/** 같은 내용이면 언제나 같은 파일이 나오게 이름 순으로 적는다. */
export function formatHashFile(file: HashFile): string {
  const lines: string[] = [];
  if (file.version !== undefined) lines.push(`version ${file.version}`);
  const names = Object.keys(file.hashes).sort((a, b) => {
    const ra = RESERVED_FIRST.includes(a) ? 0 : 1;
    const rb = RESERVED_FIRST.includes(b) ? 0 : 1;
    return ra !== rb ? ra - rb : a < b ? -1 : a > b ? 1 : 0;
  });
  for (const name of names) lines.push(`${name} ${file.hashes[name]}`);
  return lines.join("\n") + "\n";
}

export function parseHashFile(text: string): HashFile {
  const file: HashFile = { hashes: {} };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() === "") continue;
    const space = line.indexOf(" ");
    if (space < 0) throw new Error(`해시 파일의 줄 형식이 아니다: ${line}`);
    const name = line.slice(0, space);
    const value = line.slice(space + 1).trim();
    if (name === "version") file.version = value;
    else file.hashes[name] = value;
  }
  return file;
}
