import {
  addCategory,
  hashSource,
  headCommit,
  lintWiki,
  listPages,
  resolvePage,
  uncollectedSources,
  writeIndex,
  writePage,
  type IndexResult,
  type LintResult,
  type ProblemKind,
  type Source,
  wikiExists,
} from "../core/wiki.js";
import { Refusal, type Repo } from "../core/repo.js";

/** 위키 명령(PRD SYS-005). 사람이 치는 것은 없다. `wiki-ingest`와 `wiki-lint`가 부른다. */

export function wikiIndex(repo: Repo): IndexResult {
  return writeIndex(repo);
}

export function formatIndex(result: IndexResult): string {
  const lines = [`색인을 다시 만들었다: ${result.file} (페이지 ${result.pages})`];
  for (const skipped of result.skipped) lines.push(`- 싣지 못했다: ${skipped.page} (${skipped.error})`);
  return lines.join("\n");
}

export interface RecordResult {
  commit?: string;
  pages: { page: string; sources: Source[] }[];
  index: IndexResult;
}

/** 페이지의 `sources`마다 지금의 해시를 적고 `commit`을 HEAD로 적은 뒤 색인을 다시 만든다. */
export function wikiRecord(repo: Repo, given: string[]): RecordResult {
  if (given.length === 0) throw new Refusal("페이지 경로가 필요하다");
  const pages = given.map((path) => resolvePage(repo, path));
  const broken = pages.filter((page) => page.error);
  if (broken.length > 0) throw new Refusal(broken.map((page) => `frontmatter를 읽을 수 없다: ${page.rel} (${page.error})`).join("\n"));

  const commit = headCommit(repo);
  const recorded: RecordResult["pages"] = [];
  for (const page of pages) {
    const sources = (page.meta.sources ?? []).map((source) => {
      const sha256 = hashSource(repo, source.path);
      return { path: source.path, ...(sha256 ? { sha256 } : {}) };
    });
    writePage(page, { ...page.meta, sources, ...(commit ? { commit } : {}) });
    recorded.push({ page: page.rel, sources });
  }
  return { commit, pages: recorded, index: writeIndex(repo) };
}

export function formatRecord(result: RecordResult): string {
  const lines: string[] = [];
  for (const page of result.pages) {
    const missing = page.sources.filter((source) => !source.sha256).map((source) => source.path);
    lines.push(`${page.page}: 원본 ${page.sources.length}개의 해시를 적었다${result.commit ? ` (commit ${result.commit})` : ""}`);
    if (missing.length > 0) lines.push(`  원본이 없어 해시를 비웠다: ${missing.join(", ")}`);
  }
  lines.push(formatIndex(result.index));
  return lines.join("\n");
}

export function wikiLint(repo: Repo): LintResult {
  return lintWiki(repo);
}

const KIND_TEXT: Record<ProblemKind, string> = {
  format: "형식 오류",
  "broken-link": "깨진 링크",
  "source-missing": "원본이 사라진 페이지",
  stale: "낡음 후보",
  unsourced: "원본 없는 페이지",
  orphan: "고아 페이지",
  index: "색인",
};

export function formatLint(result: LintResult): string {
  if (result.problems.length === 0) return `페이지 ${result.pages}, 문제가 없다.`;
  const lines = [`페이지 ${result.pages}`];
  for (const kind of Object.keys(KIND_TEXT) as ProblemKind[]) {
    const found = result.problems.filter((problem) => problem.kind === kind);
    if (found.length === 0) continue;
    lines.push("", `${KIND_TEXT[kind]} (${found.length})`);
    for (const problem of found) lines.push(`- ${problem.page}: ${problem.message}`);
  }
  return lines.join("\n");
}

export interface SourcesResult {
  uncollected: string[];
  stale: { page: string; sources: string[] }[];
}

/** 미수집 원본과 낡음 후보. `wiki-ingest`가 대상 없이 불렸을 때 보여 준다. */
export function wikiSources(repo: Repo): SourcesResult {
  const pages = listPages(repo);
  const stale = new Map<string, string[]>();
  for (const problem of lintWiki(repo).problems) {
    if (problem.kind !== "stale") continue;
    const source = /원본이 바뀌었다: (.+?) \(/.exec(problem.message)?.[1] ?? problem.message;
    stale.set(problem.page, [...(stale.get(problem.page) ?? []), source]);
  }
  return {
    uncollected: uncollectedSources(repo, pages),
    stale: [...stale.entries()].map(([page, sources]) => ({ page, sources })),
  };
}

export function formatSources(result: SourcesResult): string {
  const lines: string[] = [];
  lines.push(result.uncollected.length > 0 ? `미수집 원본 (${result.uncollected.length})` : "미수집 원본이 없다.");
  for (const source of result.uncollected) lines.push(`- ${source}`);
  lines.push("", result.stale.length > 0 ? `낡음 후보 (${result.stale.length})` : "낡음 후보가 없다.");
  for (const page of result.stale) lines.push(`- ${page.page}: ${page.sources.join(", ")}`);
  return lines.join("\n");
}

export interface CategoryResult {
  name: string;
  description: string;
  /** 위키가 있으면 새 갈래의 절이 생기도록 색인을 다시 만든다. */
  index?: IndexResult;
}

export function wikiCategoryAdd(repo: Repo, name: string | undefined, description: string | undefined): CategoryResult {
  if (!name) throw new Refusal("갈래 이름이 필요하다");
  addCategory(repo, name, description ?? "");
  return { name, description: (description ?? "").trim(), ...(wikiExists(repo) ? { index: writeIndex(repo) } : {}) };
}
