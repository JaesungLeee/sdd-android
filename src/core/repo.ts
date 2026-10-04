import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { DocState } from "./chain.js";
import { formatDoc, parseDoc, type Meta, type ParsedDoc } from "./frontmatter.js";
import {
  diffHashes,
  formatHashFile,
  hashBody,
  isUnchanged,
  parseHashFile,
  type DocKind,
  type HashFile,
  type Hashes,
} from "./hash.js";

/** 문서를 만드는 단계. checklist는 spec 단계의 산출물이다. */
export type Stage = "constitution" | "prd" | "spec" | "blueprint" | "breakdown";

export const STAGES: readonly Stage[] = ["constitution", "prd", "spec", "blueprint", "breakdown"];

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

export function isFeatureStage(stage: Stage): boolean {
  return stage === "spec" || stage === "blueprint" || stage === "breakdown";
}

/** CLI가 요청을 거부할 때 던진다. 메시지는 그대로 사용자와 에이전트에게 보인다. */
export class Refusal extends Error {}

export interface Config {
  language: string;
  agent: string;
  docs_dir: string;
  prefix: string;
}

export interface Repo {
  root: string;
  config: Config;
}

const STATE_DIR = ".sdd-first";

export function findRoot(start: string): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, STATE_DIR, "config.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function openRepo(root: string): Repo {
  const file = path.join(root, STATE_DIR, "config.yaml");
  if (!fs.existsSync(file)) throw new Refusal(`sdd-first가 설치되지 않은 저장소다: ${root}`);
  const data = (parse(fs.readFileSync(file, "utf8")) ?? {}) as Partial<Config>;
  return {
    root,
    config: {
      language: data.language ?? "ko",
      agent: data.agent ?? "claude-code",
      docs_dir: data.docs_dir ?? "docs",
      prefix: data.prefix ?? "",
    },
  };
}

const FEATURE_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function assertFeatureName(feature: string): void {
  if (!FEATURE_NAME.test(feature)) {
    throw new Refusal(`feature 이름은 소문자, 숫자, 하이픈만 쓴다: ${feature}`);
  }
}

/** 산출물 디렉터리 안에서의 문서 경로. 파일 이름은 언어와 무관하게 고정이다. */
export function docRelPath(kind: DocKind, feature?: string): string {
  if (kind === "constitution" || kind === "prd") return `${kind}.md`;
  if (!feature) throw new Refusal(`${kind}에는 feature 이름이 필요하다`);
  return path.join("specs", feature, `${kind}.md`);
}

export function docsDir(repo: Repo): string {
  return path.join(repo.root, repo.config.docs_dir);
}

export function docPath(repo: Repo, kind: DocKind, feature?: string): string {
  return path.join(docsDir(repo), docRelPath(kind, feature));
}

export function hashPath(repo: Repo, kind: DocKind, feature?: string): string {
  return path.join(repo.root, STATE_DIR, "hashes", `${docRelPath(kind, feature)}.hash`);
}

export function readTemplate(repo: Repo, name: string): string | undefined {
  const file = path.join(repo.root, STATE_DIR, "templates", `${name}.md`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

export function listFeatures(repo: Repo): string[] {
  const dir = path.join(docsDir(repo), "specs");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export interface LoadedDoc {
  kind: DocKind;
  feature?: string;
  path: string;
  parsed: ParsedDoc;
  meta: Meta;
  body: string;
  recorded?: HashFile;
  current: Hashes;
  /** 완료된 뒤 본문이 기록된 해시와 달라졌다. */
  unrecorded: boolean;
}

export function loadDoc(repo: Repo, kind: DocKind, feature?: string): LoadedDoc | undefined {
  const file = docPath(repo, kind, feature);
  if (!fs.existsSync(file)) return undefined;

  const parsed = parseDoc(fs.readFileSync(file, "utf8"));
  const hashFile = hashPath(repo, kind, feature);
  const recorded = fs.existsSync(hashFile) ? parseHashFile(fs.readFileSync(hashFile, "utf8")) : undefined;
  const current = hashBody(kind, parsed.body);
  const unrecorded =
    kind !== "checklist" &&
    parsed.meta.status === "created" &&
    (!recorded || !isUnchanged(diffHashes(recorded.hashes, current)));

  return { kind, feature, path: file, parsed, meta: parsed.meta, body: parsed.body, recorded, current, unrecorded };
}

export function toState(doc: LoadedDoc): DocState {
  return { meta: doc.meta, unrecorded: doc.unrecorded };
}

const CHAIN_KINDS: readonly DocKind[] = ["constitution", "prd", "spec", "blueprint", "breakdown"];

/** 사슬 판정에 넣을 문서들. feature가 없으면 프로젝트 문서만 읽는다. */
export function loadDocs(repo: Repo, feature?: string): Partial<Record<DocKind, LoadedDoc>> {
  const docs: Partial<Record<DocKind, LoadedDoc>> = {};
  for (const kind of CHAIN_KINDS) {
    const projectDoc = kind === "constitution" || kind === "prd";
    if (!projectDoc && !feature) continue;
    const doc = loadDoc(repo, kind, projectDoc ? undefined : feature);
    if (doc) docs[kind] = doc;
  }
  return docs;
}

export function toStates(docs: Partial<Record<DocKind, LoadedDoc>>): Partial<Record<DocKind, DocState>> {
  const states: Partial<Record<DocKind, DocState>> = {};
  for (const [kind, doc] of Object.entries(docs)) states[kind as DocKind] = toState(doc);
  return states;
}

export function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export function writeDoc(repo: Repo, kind: DocKind, feature: string | undefined, meta: Meta, body: string): void {
  writeFile(docPath(repo, kind, feature), formatDoc(meta, body));
}

export function writeHashes(repo: Repo, kind: DocKind, feature: string | undefined, file: HashFile): void {
  writeFile(hashPath(repo, kind, feature), formatHashFile(file));
}

export interface PathTarget {
  stage: Stage;
  feature?: string;
}

/**
 * 파일 경로가 어느 단계의 산출물인지 가린다. 사슬 문서와 그 부속 산출물만 해당한다.
 * 배치에 없는 파일은 `docs/` 아래에 있어도 사슬 문서가 아니다.
 */
export function classifyPath(repo: Repo, file: string): PathTarget | undefined {
  const rel = path.relative(docsDir(repo), path.resolve(file));
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  const parts = rel.split(path.sep);

  if (parts.length === 1) {
    if (parts[0] === "constitution.md") return { stage: "constitution" };
    if (parts[0] === "prd.md") return { stage: "prd" };
    return undefined;
  }
  if (parts[0] !== "specs" || parts.length < 3) return undefined;

  const feature = parts[1] as string;
  const name = parts[2] as string;
  if (name === "spec.md" || name === "checklist.md") return { stage: "spec", feature };
  if (["blueprint.md", "research.md", "data-model.md", "quickstart.md", "contracts"].includes(name)) {
    return { stage: "blueprint", feature };
  }
  if (name === "breakdown.md") return { stage: "breakdown", feature };
  return undefined;
}

export function localDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
