import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { splitItems } from "./items.js";
import { normalizeText } from "./normalize.js";
import type { Repo } from "./repo.js";

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

// 경로의 내용 해시

/**
 * 저장소 안 경로의 내용 해시. 파일은 사슬 문서의 정규화 가운데 앞의 네 규칙(LF, 줄 끝 공백, 끝의 빈 줄, NFC)을 거치고,
 * 바이너리는 바이트 그대로, 디렉터리는 git이 보는 파일의 `경로 해시` 줄을 이은 것이다. 경로가 없으면 비어 있다.
 */
export function hashSource(repo: Repo, source: string): string | undefined {
  const rel = normalizeSource(source);
  const full = path.join(repo.root, rel);
  if (!fs.existsSync(full)) return undefined;
  return fs.statSync(full).isDirectory() ? hashDirectory(repo, rel) : hashFile(full);
}

function normalizeSource(source: string): string {
  return source.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function hashFile(full: string): string {
  const bytes = fs.readFileSync(full);
  if (bytes.includes(0)) return createHash("sha256").update(bytes).digest("hex");
  return sha256(normalizeText(bytes.toString("utf8")));
}

function hashDirectory(repo: Repo, rel: string): string {
  const files = [...new Set(filesUnder(repo, rel))]
    .filter((file) => {
      const full = path.join(repo.root, file);
      return fs.existsSync(full) && fs.statSync(full).isFile();
    })
    .sort();
  return sha256(files.map((file) => `${file} ${hashFile(path.join(repo.root, file))}`).join("\n"));
}

/** 추적 중인 파일과 무시되지 않은 미추적 파일. 작업 트리의 내용을 읽으므로 커밋 전의 변경도 반영된다. */
function filesUnder(repo: Repo, rel: string): string[] {
  try {
    const out = execFileSync("git", ["-C", repo.root, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", rel], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\0").filter(Boolean);
  } catch {
    return walkFiles(repo.root, rel);
  }
}

function walkFiles(root: string, rel: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(path.join(root, rel));
  return found;
}
