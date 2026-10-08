import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseDocument, stringify } from "yaml";
import { pathCovers } from "./breakdown.js";
import { parseDoc } from "./frontmatter.js";
import { sha256 } from "./hash.js";
import { normalizeText } from "./normalize.js";
import { docsDir, listFeatures, loadDoc, Refusal, writeFile, type Repo } from "./repo.js";

/**
 * 위키의 계산 부분(PRD SYS-005). 페이지 읽기, 원본 해시, 색인, 점검의 계산, 미수집 원본.
 * 위키는 사슬 밖이라 판정에 들어가지 않고, 쓰는 것은 수집과 점검 스킬이며 CLI는 해시와 `commit`과 색인만 적는다.
 */

/** 기본 갈래. 설정에는 사용자가 더한 갈래만 적는다. */
export const DEFAULT_CATEGORIES: Readonly<Record<string, string>> = {
  architecture: "계층, 모듈, 의존 방향, 흐름, 데이터 모델",
  conventions: "관찰된 규약",
  adr: "결정 기록",
  failures: "실패 기록",
};
/** 저장소 밖 자료 전용. 페이지가 아니며 색인에 넣지 않는다. */
export const RAW_DIR = "raw";
export const INDEX_FILE = "index.md";
const CATEGORY_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function wikiDir(repo: Repo): string {
  return path.join(docsDir(repo), "wiki");
}

/** 저장소 루트에서 본 위키의 경로. 슬래시로 적는다. */
export function wikiRel(repo: Repo): string {
  return toPosix(path.relative(repo.root, wikiDir(repo)));
}

export function wikiExists(repo: Repo): boolean {
  return fs.existsSync(wikiDir(repo));
}

export function categories(repo: Repo): Record<string, string> {
  return { ...DEFAULT_CATEGORIES, ...(repo.config.wiki?.categories ?? {}) };
}

/** 갈래를 설정에 더한다. 설정 파일의 다른 내용과 주석은 그대로 둔다. */
export function addCategory(repo: Repo, name: string, description: string): void {
  if (!CATEGORY_NAME.test(name)) throw new Refusal(`갈래 이름은 소문자, 숫자, 하이픈만 쓴다: ${name}`);
  if (name === RAW_DIR || name in categories(repo)) throw new Refusal(`이미 있는 갈래다: ${name}`);
  if (!description.trim()) throw new Refusal("갈래의 설명이 필요하다(--description)");
  const file = path.join(repo.root, ".mob-sdd", "config.yaml");
  const doc = parseDocument(fs.readFileSync(file, "utf8"));
  doc.setIn(["wiki", "categories", name], description.trim());
  fs.writeFileSync(file, doc.toString());
  repo.config.wiki = { categories: { ...(repo.config.wiki?.categories ?? {}), [name]: description.trim() } };
}

export interface Source {
  /** 저장소 루트 기준의 경로. `/`로 끝나면 디렉터리다. */
  path: string;
  /** 수집 당시의 해시. CLI가 적는다. 원본이 없으면 비어 있다. */
  sha256?: string;
}

export interface PageMeta {
  title?: string;
  summary?: string;
  /** adr만. `accepted`나 `superseded`. */
  status?: string;
  /** adr만. 뒤집은 결정의 페이지. 위키 루트 기준의 경로다. */
  superseded_by?: string;
  sources?: Source[];
  /** 수집 시점의 커밋. 낡음 판정에는 쓰지 않고 diff를 읽기 위한 힌트다. */
  commit?: string;
}

export interface Page {
  /** 위키 루트에서 본 경로. 슬래시로 적는다. */
  rel: string;
  file: string;
  category: string;
  meta: PageMeta;
  body: string;
  /** frontmatter를 읽지 못했거나 형식이 어긋난 이유. */
  error?: string;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function readPage(repo: Repo, file: string): Page {
  const rel = toPosix(path.relative(wikiDir(repo), file));
  const category = rel.split("/")[0] as string;
  const parsed = parseDoc(fs.readFileSync(file, "utf8"));
  if (!parsed.hasFrontmatter) return { rel, file, category, meta: {}, body: parsed.body, error: "frontmatter가 없다" };
  if (parsed.error) return { rel, file, category, meta: {}, body: parsed.body, error: parsed.error };
  const { meta, error } = readMeta(parsed.meta as Record<string, unknown>);
  return { rel, file, category, meta, body: parsed.body, ...(error ? { error } : {}) };
}

function readMeta(raw: Record<string, unknown>): { meta: PageMeta; error?: string } {
  const meta: PageMeta = {};
  const text = (key: "title" | "summary" | "status" | "superseded_by" | "commit") => {
    const value = raw[key];
    if (typeof value === "string") meta[key] = value;
    else if (typeof value === "number") meta[key] = String(value);
  };
  text("title");
  text("summary");
  text("status");
  text("superseded_by");
  text("commit");
  if (raw.sources !== undefined) {
    if (!Array.isArray(raw.sources)) return { meta, error: "sources가 목록이 아니다" };
    const sources: Source[] = [];
    for (const item of raw.sources) {
      if (!item || typeof item !== "object" || typeof (item as Source).path !== "string") return { meta, error: "sources의 항목에 path가 없다" };
      const given = item as Source;
      sources.push({ path: given.path, ...(typeof given.sha256 === "string" ? { sha256: given.sha256 } : {}) });
    }
    meta.sources = sources;
  }
  return { meta };
}

/** 모든 갈래의 페이지. `raw/`와 색인, 갈래 밖의 파일은 페이지가 아니다. 경로순이다. */
export function listPages(repo: Repo): Page[] {
  const root = wikiDir(repo);
  if (!fs.existsSync(root)) return [];
  const pages: Page[] = [];
  const walk = (dir: string) => {
    for (const entry of sortedEntries(dir)) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) pages.push(readPage(repo, full));
    }
  };
  for (const entry of sortedEntries(root)) {
    if (entry.isDirectory() && entry.name !== RAW_DIR) walk(path.join(root, entry.name));
  }
  return pages;
}

function sortedEntries(dir: string): fs.Dirent[] {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** 페이지 경로를 저장소 루트 기준이나 위키 루트 기준 어느 쪽으로 받아도 찾는다. */
export function resolvePage(repo: Repo, given: string): Page {
  const candidates = [path.resolve(repo.root, given), path.resolve(wikiDir(repo), given)];
  const file = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!file) throw new Refusal(`페이지가 없다: ${given}`);
  const rel = toPosix(path.relative(wikiDir(repo), file));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Refusal(`위키 밖의 파일이다: ${given}`);
  if (rel === INDEX_FILE || !rel.includes("/")) throw new Refusal(`갈래 아래의 페이지가 아니다: ${given}`);
  if (rel.startsWith(`${RAW_DIR}/`)) throw new Refusal(`raw/의 자료는 페이지가 아니다: ${given}`);
  return readPage(repo, file);
}

// 원본의 해시

/**
 * 원본의 해시. 파일은 사슬 문서의 정규화 가운데 앞의 네 규칙(LF, 줄 끝 공백, 끝의 빈 줄, NFC)을 거치고,
 * 바이너리는 바이트 그대로, 디렉터리는 git이 보는 파일의 `경로 해시` 줄을 이은 것이다. 원본이 없으면 비어 있다.
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
    for (const entry of sortedEntries(dir)) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(toPosix(path.relative(root, full)));
    }
  };
  walk(path.join(root, rel));
  return found;
}

// 커밋

export function headCommit(repo: Repo): string | undefined {
  try {
    return execFileSync("git", ["-C", repo.root, "rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** 그 커밋이 지금 HEAD의 이력에 있는지. squash 병합이나 rebase 뒤에는 없을 수 있고, 그것은 낡음의 근거가 아니다. */
export function commitInHistory(repo: Repo, commit: string): boolean {
  try {
    execFileSync("git", ["-C", repo.root, "merge-base", "--is-ancestor", commit, "HEAD"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// 쓰기

function scalar(value: string): string {
  return stringify(value, { lineWidth: 0 }).trimEnd();
}

/** 페이지의 frontmatter를 고정된 순서로 적는다. */
export function formatPageMeta(meta: PageMeta): string {
  const lines: string[] = [];
  if (meta.title !== undefined) lines.push(`title: ${scalar(meta.title)}`);
  if (meta.summary !== undefined) lines.push(`summary: ${scalar(meta.summary)}`);
  if (meta.status !== undefined) lines.push(`status: ${scalar(meta.status)}`);
  if (meta.superseded_by !== undefined) lines.push(`superseded_by: ${scalar(meta.superseded_by)}`);
  if (meta.sources !== undefined) {
    if (meta.sources.length === 0) lines.push("sources: []");
    else {
      lines.push("sources:");
      for (const source of meta.sources) {
        lines.push(`  - path: ${scalar(source.path)}`);
        if (source.sha256) lines.push(`    sha256: ${source.sha256}`);
      }
    }
  }
  if (meta.commit !== undefined) lines.push(`commit: ${scalar(meta.commit)}`);
  return lines.join("\n") + "\n";
}

export function writePage(page: Page, meta: PageMeta): void {
  writeFile(page.file, `---\n${formatPageMeta(meta)}---\n${page.body}`);
}

// 링크

const LINK = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g;

/** 본문의 상대 링크. 바깥 주소(`http`, `mailto`)와 같은 페이지 안의 앵커는 뺀다. */
export function extractLinks(body: string): string[] {
  const links: string[] = [];
  for (const match of body.matchAll(LINK)) {
    const target = (match[1] ?? match[2]) as string;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    links.push(target);
  }
  return links;
}

/**
 * 링크를 위키 루트 기준의 경로로 푼다. `/`로 시작하면 저장소 루트 기준이고, 아니면 페이지가 있는 디렉터리 기준이다.
 * 위키 밖을 가리키면 `outside`에 저장소 루트 기준의 경로를 둔다.
 */
export function resolveLink(repo: Repo, pageRel: string, link: string): { wiki?: string; outside?: string } {
  const clean = link.replace(/[#?].*$/, "");
  if (!clean) return {};
  const base = wikiRel(repo);
  const fromRoot = clean.startsWith("/") ? path.posix.normalize(clean.slice(1)) : path.posix.normalize(path.posix.join(base, path.posix.dirname(pageRel), clean));
  const inWiki = path.posix.relative(base, fromRoot);
  if (inWiki.startsWith("..")) return { outside: fromRoot };
  return { wiki: inWiki };
}

// 색인

/** 색인의 갈래 순서: 기본 갈래는 정해진 순서로, 더한 갈래는 이름순으로 뒤에. */
function orderedCategories(repo: Repo, pages: Page[]): string[] {
  const known = categories(repo);
  const extra = [...new Set([...Object.keys(known), ...pages.map((page) => page.category)])].filter((name) => !(name in DEFAULT_CATEGORIES)).sort();
  return [...Object.keys(DEFAULT_CATEGORIES), ...extra];
}

export function buildIndex(repo: Repo, pages: Page[]): string {
  const known = categories(repo);
  const lines = ["# 위키 색인", "", "<!-- mob-sdd wiki index가 만든다. 손으로 고치지 않고 다시 만든다. -->"];
  for (const category of orderedCategories(repo, pages)) {
    lines.push("", `## ${category}`);
    if (known[category]) lines.push("", known[category] as string);
    const listed = pages.filter((page) => page.category === category && !page.error && page.meta.title);
    lines.push("");
    if (listed.length === 0) lines.push("- (페이지 없음)");
    for (const page of listed) {
      const state = page.meta.status === "superseded" ? " (superseded)" : "";
      const summary = page.meta.summary ? `: ${page.meta.summary}` : "";
      lines.push(`- [${page.meta.title}](${page.rel})${state}${summary}`);
    }
  }
  return lines.join("\n") + "\n";
}

export interface IndexResult {
  file: string;
  pages: number;
  /** 색인에 싣지 못한 페이지와 그 이유. */
  skipped: { page: string; error: string }[];
}

/** 색인을 다시 만든다. 위키 디렉터리가 없으면 만든다. */
export function writeIndex(repo: Repo): IndexResult {
  const pages = listPages(repo);
  const file = path.join(wikiDir(repo), INDEX_FILE);
  writeFile(file, buildIndex(repo, pages));
  const skipped = pages.filter((page) => page.error || !page.meta.title).map((page) => ({ page: page.rel, error: page.error ?? "title이 없다" }));
  return { file: toPosix(path.relative(repo.root, file)), pages: pages.length - skipped.length, skipped };
}

// 점검의 계산 부분

export type ProblemKind = "format" | "broken-link" | "source-missing" | "stale" | "unsourced" | "orphan" | "index";

export interface WikiProblem {
  level: "error" | "warn";
  kind: ProblemKind;
  /** 위키 루트에서 본 페이지 경로. 색인의 문제는 `index.md`다. */
  page: string;
  message: string;
  /** 낡음 후보에서, `commit`이 HEAD의 이력에 있어 diff로 읽을 수 있는지. */
  commitInHistory?: boolean;
}

export interface LintResult {
  pages: number;
  problems: WikiProblem[];
}

export function lintWiki(repo: Repo): LintResult {
  const pages = listPages(repo);
  const problems: WikiProblem[] = [];
  const linked = new Set<string>();
  const add = (level: WikiProblem["level"], kind: ProblemKind, page: string, message: string, extra: Partial<WikiProblem> = {}) =>
    problems.push({ level, kind, page, message, ...extra });

  for (const page of pages) {
    if (page.error) {
      add("error", "format", page.rel, page.error);
      continue;
    }
    if (!page.meta.title) add("error", "format", page.rel, "title이 없다");
    if (!page.meta.summary) add("error", "format", page.rel, "summary가 없다");
    if (page.category === "adr") {
      if (page.meta.status !== "accepted" && page.meta.status !== "superseded") add("error", "format", page.rel, "adr의 status는 accepted나 superseded다");
      if (page.meta.status === "superseded" && !page.meta.superseded_by) add("error", "format", page.rel, "superseded인데 superseded_by가 없다");
    }
    for (const link of extractLinks(page.body)) {
      const target = resolveLink(repo, page.rel, link);
      if (target.wiki !== undefined) {
        if (fs.existsSync(path.join(wikiDir(repo), target.wiki))) linked.add(target.wiki);
        else add("error", "broken-link", page.rel, `가리키는 파일이 없다: ${link}`);
      } else if (target.outside !== undefined && !fs.existsSync(path.join(repo.root, target.outside))) {
        add("error", "broken-link", page.rel, `가리키는 파일이 없다: ${link}`);
      }
    }
    if (page.meta.superseded_by) {
      if (fs.existsSync(path.join(wikiDir(repo), page.meta.superseded_by))) linked.add(page.meta.superseded_by);
      else add("error", "broken-link", page.rel, `superseded_by가 가리키는 페이지가 없다: ${page.meta.superseded_by}`);
    }
    const sources = page.meta.sources ?? [];
    if (sources.length === 0) add("warn", "unsourced", page.rel, "원본(sources)이 없다");
    for (const source of sources) {
      const current = hashSource(repo, source.path);
      if (current === undefined) add("error", "source-missing", page.rel, `원본이 없다: ${source.path}`);
      else if (source.sha256 !== current) {
        const inHistory = page.meta.commit ? commitInHistory(repo, page.meta.commit) : false;
        const hint = inHistory ? `git diff ${page.meta.commit} -- ${source.path}` : "원본을 다시 읽는다";
        add("warn", "stale", page.rel, `원본이 바뀌었다: ${source.path} (${hint})`, { commitInHistory: inHistory });
      }
    }
  }
  if (pages.length > 1) {
    for (const page of pages) {
      if (!page.error && !linked.has(page.rel)) add("warn", "orphan", page.rel, "어떤 페이지도 이 페이지를 링크하지 않는다");
    }
  }
  const indexFile = path.join(wikiDir(repo), INDEX_FILE);
  if (!fs.existsSync(indexFile)) add("warn", "index", INDEX_FILE, "색인이 없다. wiki index로 만든다");
  else if (normalizeText(fs.readFileSync(indexFile, "utf8")) !== normalizeText(buildIndex(repo, pages))) {
    add("warn", "index", INDEX_FILE, "색인이 페이지 목록과 다르다. wiki index로 다시 만든다");
  }
  return { pages: pages.length, problems };
}

// 미수집 원본

/**
 * 셀 수 있는 원본 가운데 어느 페이지의 `sources`에도 없는 것. 리서치 기록(blueprint가 완료된 feature), 실패 기록, `raw/`의 자료다.
 * 코드와 기존 문서는 세지 않는다. 어느 디렉터리가 수집의 단위인지는 사람이 정한다.
 */
export function uncollectedSources(repo: Repo, pages: Page[] = listPages(repo)): string[] {
  const candidates: string[] = [];
  const relOf = (file: string) => toPosix(path.relative(repo.root, file));
  for (const feature of listFeatures(repo)) {
    const blueprint = loadDoc(repo, "blueprint", feature);
    const dir = path.join(docsDir(repo), "specs", feature);
    if (blueprint?.meta.status === "created" && fs.existsSync(path.join(dir, "research.md"))) candidates.push(relOf(path.join(dir, "research.md")));
    if (fs.existsSync(path.join(dir, "failures.md"))) candidates.push(relOf(path.join(dir, "failures.md")));
  }
  const raw = path.join(wikiDir(repo), RAW_DIR);
  if (fs.existsSync(raw)) candidates.push(...walkFiles(repo.root, toPosix(path.relative(repo.root, raw))));
  const cited = pages.flatMap((page) => (page.meta.sources ?? []).map((source) => source.path));
  return candidates.filter((candidate) => !cited.some((source) => pathCovers(source, candidate)));
}

/** `status`에 싣는 한 줄의 수. 위키가 없으면 없다. */
export function wikiSummary(repo: Repo): { pages: number; stale: number; uncollected: number } | undefined {
  if (!wikiExists(repo)) return undefined;
  const lint = lintWiki(repo);
  return {
    pages: lint.pages,
    stale: new Set(lint.problems.filter((problem) => problem.kind === "stale").map((problem) => problem.page)).size,
    uncollected: uncollectedSources(repo).length,
  };
}
