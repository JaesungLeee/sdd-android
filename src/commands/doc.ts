import fs from "node:fs";
import { judgeChain, judgeRelation, RELATIONS, type RelationResult } from "../core/chain.js";
import type { Meta } from "../core/frontmatter.js";
import { BODY, diffHashes, hasItems, isUnchanged, OUTSIDE, type DocKind, type HashDiff } from "../core/hash.js";
import { ITEM_ID_PATTERN, splitItems } from "../core/items.js";
import {
  assertFeatureName,
  docPath,
  isFeatureStage,
  listFeatures,
  loadDoc,
  loadDocs,
  readTemplate,
  Refusal,
  toState,
  toStates,
  writeDoc,
  writeFile,
  writeHashes,
  type LoadedDoc,
  type Repo,
  type Stage,
} from "../core/repo.js";
import { bumpVersion, gradeAtLeast, isGrade, maxGrade, type Grade } from "../core/version.js";
import { describeReason, stageGate } from "./gate.js";

export interface WriteOptions {
  today: string;
  /** 판정이 확인 필요일 때 사용자가 계속하기로 했다는 표시. */
  acknowledged?: boolean;
}

const VERIFIED_SPEC = "verified-spec";

function requireFeature(stage: Stage, feature: string | undefined): string | undefined {
  if (!isFeatureStage(stage)) return undefined;
  if (!feature) throw new Refusal(`${stage} 단계에는 feature 이름이 필요하다`);
  assertFeatureName(feature);
  return feature;
}

/** 쓰기 명령은 판정을 다시 한다. 중단이면 언제나, 확인 필요면 인자가 없을 때 거부한다. */
function ensureGate(repo: Repo, stage: Stage, feature: string | undefined, acknowledged: boolean | undefined): void {
  const gate = stageGate(repo, stage, feature);
  if (gate.action === "pass") return;
  const reasons = gate.reasons.filter((reason) => reason.action === gate.action).map(describeReason).join(", ");
  if (gate.action === "block") throw new Refusal(`중단: ${reasons}. 그 문서의 단계를 먼저 다시 실행한다.`);
  if (!acknowledged) {
    throw new Refusal(`확인 필요: ${reasons}. 사용자가 계속하기로 했으면 --acknowledged를 붙인다.`);
  }
}

function requireDoc(repo: Repo, stage: Stage, feature: string | undefined): LoadedDoc {
  const doc = loadDoc(repo, stage, feature);
  if (!doc) throw new Refusal(`문서가 없다: ${docPath(repo, stage, feature)}. doc new로 만든다.`);
  if (doc.parsed.error) throw new Refusal(`${doc.path}: ${doc.parsed.error}`);
  return doc;
}

/** 이 단계의 산출물이 기준으로 삼는 상위 문서의 버전을 지금의 버전으로 맞춘다. 의존 항목은 그대로 둔다. */
function refreshBases(repo: Repo, stage: Stage, feature: string | undefined, meta: Meta): string[] {
  const updated: string[] = [];
  for (const relation of RELATIONS) {
    if (relation.lower !== stage) continue;
    const upper = loadDoc(repo, relation.upper, isProjectDoc(relation.upper) ? undefined : feature);
    if (!upper?.meta.version || upper.meta.status !== "created") continue;
    const base = meta.based_on?.[relation.upper];
    if (base?.version === upper.meta.version) continue;
    meta.based_on = { ...meta.based_on, [relation.upper]: { ...base, version: upper.meta.version } };
    updated.push(relation.upper);
  }
  return updated;
}

function isProjectDoc(kind: DocKind): boolean {
  return kind === "constitution" || kind === "prd";
}

function applyDepends(repo: Repo, meta: Meta, depends: string[] | undefined): void {
  if (depends === undefined) return;
  const prd = loadDoc(repo, "prd");
  if (!prd?.meta.version) throw new Refusal("prd가 없거나 완료되지 않아 의존 항목을 적을 수 없다");
  const known = new Set(Object.keys(prd.current).filter((name) => name !== OUTSIDE));
  for (const id of depends) {
    if (!ITEM_ID_PATTERN.test(id)) throw new Refusal(`항목 ID 형식이 아니다: ${id}`);
    if (!known.has(id)) throw new Refusal(`prd에 없는 항목이다: ${id}`);
  }
  const base = meta.based_on?.prd;
  meta.based_on = {
    ...meta.based_on,
    prd: { version: base?.version ?? prd.meta.version, items: [...new Set(depends)].sort() },
  };
}

/** spec은 체크리스트가 pass이고 지금의 본문을 검증한 것일 때만 완료나 개정을 기록한다. */
function requireChecklist(repo: Repo, feature: string, spec: LoadedDoc): LoadedDoc {
  const checklist = loadDoc(repo, "checklist", feature);
  if (!checklist) throw new Refusal("checklist가 없다");
  if (checklist.meta.status !== "pass") {
    throw new Refusal(`checklist가 pass가 아니다(${checklist.meta.status ?? "없음"}). 항목을 평가한 뒤 doc checklist를 실행한다.`);
  }
  if (checklist.recorded?.hashes[VERIFIED_SPEC] !== spec.current[BODY]) {
    throw new Refusal("checklist를 검증한 뒤 spec 본문이 바뀌었다. 다시 검증하고 doc checklist를 실행한다.");
  }
  return checklist;
}

function stampChecklist(repo: Repo, feature: string, checklist: LoadedDoc, specVersion: string): void {
  writeDoc(repo, "checklist", feature, { ...checklist.meta, based_on: { spec: { version: specVersion } } }, checklist.body);
}

function assertNoDuplicateItems(doc: LoadedDoc): void {
  if (!hasItems(doc.kind)) return;
  const { duplicates } = splitItems(doc.body);
  if (duplicates.length > 0) throw new Refusal(`항목 ID가 중복됐다: ${duplicates.join(", ")}`);
}

export interface NewResult {
  created: string[];
}

/** Flow A의 시작. 템플릿을 복사하고 `draft`로 둔다. */
export function docNew(repo: Repo, stage: Stage, featureArg: string | undefined, options: WriteOptions): NewResult {
  const feature = requireFeature(stage, featureArg);
  const file = docPath(repo, stage, feature);
  if (fs.existsSync(file)) throw new Refusal(`이미 있는 문서다: ${file}. 고친 뒤 doc changes와 doc revise를 쓴다.`);
  ensureGate(repo, stage, feature, options.acknowledged);

  const template = readTemplate(repo, stage);
  if (template === undefined) throw new Refusal(`템플릿이 없다: ${stage}`);

  const meta: Meta = { status: "draft", created: options.today };
  refreshBases(repo, stage, feature, meta);
  writeDoc(repo, stage, feature, meta, template);
  const created = [file];

  if (stage === "spec" && feature) {
    const checklist = readTemplate(repo, "checklist");
    if (checklist === undefined) throw new Refusal("템플릿이 없다: checklist");
    writeDoc(repo, "checklist", feature, { status: "draft" }, checklist);
    created.push(docPath(repo, "checklist", feature));
  }
  if (stage === "blueprint" && feature) {
    const research = readTemplate(repo, "research");
    const researchFile = docPath(repo, "blueprint", feature).replace(/blueprint\.md$/, "research.md");
    if (research !== undefined && !fs.existsSync(researchFile)) {
      writeFile(researchFile, research);
      created.push(researchFile);
    }
  }
  return { created };
}

export interface CompleteOptions extends WriteOptions {
  /** spec이 의존하는 prd 항목. 사용자가 승인한 목록이다. */
  depends?: string[];
}

export interface RecordResult {
  version: string;
  grade?: Grade;
  /** 이 기록으로 뒤처진 하위 문서. */
  stale: StaleDoc[];
}

/** Flow A의 끝. 완료를 기록한다. 에이전트는 완료를 선언할 수 없고 이 명령만 `created`를 만든다. */
export function docComplete(
  repo: Repo,
  stage: Stage,
  featureArg: string | undefined,
  options: CompleteOptions,
): RecordResult {
  const feature = requireFeature(stage, featureArg);
  const doc = requireDoc(repo, stage, feature);
  if (doc.meta.status !== "draft") throw new Refusal("이미 완료된 문서다. 개정은 doc revise로 기록한다.");
  ensureGate(repo, stage, feature, options.acknowledged);
  assertNoDuplicateItems(doc);

  const meta: Meta = { ...doc.meta };
  assertBasesCurrent(repo, stage, feature, doc);
  refreshMissingBases(repo, stage, feature, meta);

  let checklist: LoadedDoc | undefined;
  if (stage === "spec" && feature) {
    applyDepends(repo, meta, options.depends);
    checklist = requireChecklist(repo, feature, doc);
  }

  const version = "1.0.0";
  meta.version = version;
  meta.status = "created";
  meta.created = meta.created ?? options.today;
  meta.updated = options.today;
  if (hasItems(stage)) meta.revisions = [{ version, date: options.today }];

  writeDoc(repo, stage, feature, meta, doc.body);
  writeHashes(repo, stage, feature, { version, hashes: doc.current });
  if (checklist && feature) stampChecklist(repo, feature, checklist, version);

  return { version, stale: staleDocs(repo, stage, feature) };
}

/** 작성 중에 상위 문서가 개정됐으면 완료를 기록하지 않는다. 내용을 맞춘 뒤 doc confirm으로 기준을 올린다. */
function assertBasesCurrent(repo: Repo, stage: Stage, feature: string | undefined, doc: LoadedDoc): void {
  for (const relation of RELATIONS) {
    if (relation.lower !== stage || !doc.meta.based_on?.[relation.upper]) continue;
    const upper = loadDoc(repo, relation.upper, isProjectDoc(relation.upper) ? undefined : feature);
    if (!upper) continue;
    const verdict = judgeRelation(toState(doc), relation.upper, toState(upper));
    if (verdict === "behind-minor" || verdict === "behind-major") {
      throw new Refusal(
        `작성하는 동안 ${relation.upper}가 개정됐다(${doc.meta.based_on[relation.upper]?.version} → ${upper.meta.version}). 내용을 맞춘 뒤 doc confirm을 실행한다.`,
      );
    }
  }
}

/** 문서를 만든 뒤에 생긴 상위 문서(예: 나중에 만든 prd)를 기준으로 더한다. 이미 있는 기준은 건드리지 않는다. */
function refreshMissingBases(repo: Repo, stage: Stage, feature: string | undefined, meta: Meta): void {
  const probe: Meta = {};
  refreshBases(repo, stage, feature, probe);
  for (const [upper, base] of Object.entries(probe.based_on ?? {})) {
    if (!meta.based_on?.[upper]) meta.based_on = { ...meta.based_on, [upper]: base };
  }
}

export interface ChangesResult {
  version: string;
  /** 바뀐 곳이 있는지. */
  dirty: boolean;
  changed: string[];
  added: string[];
  removed: string[];
  /** CLI가 고정하는 등급의 하한. 지워진 항목은 major, 새 항목은 minor 이상이다. */
  floors: Record<string, Grade>;
}

function requireCreated(doc: LoadedDoc): { version: string; diff: HashDiff } {
  if (doc.meta.status !== "created" || !doc.meta.version) {
    throw new Refusal("완료되지 않은 문서다. doc complete로 완료를 기록한다.");
  }
  if (!doc.recorded) throw new Refusal("기록된 해시가 없다. check로 상태를 확인한다.");
  return { version: doc.meta.version, diff: diffHashes(doc.recorded.hashes, doc.current) };
}

/** Flow B에서 무엇이 바뀌었는지 계산한다. 에이전트는 얼마나 크게 바뀌었는지만 제안한다. */
export function docChanges(repo: Repo, stage: Stage, featureArg: string | undefined): ChangesResult {
  const feature = requireFeature(stage, featureArg);
  const doc = requireDoc(repo, stage, feature);
  const { version, diff } = requireCreated(doc);
  const floors: Record<string, Grade> = {};
  for (const id of diff.removed) floors[id] = "major";
  for (const id of diff.added) floors[id] = "minor";
  return { version, dirty: !isUnchanged(diff), ...diff, floors };
}

export interface ReviseOptions extends CompleteOptions {
  /** prd와 constitution은 바뀐 항목마다의 등급. */
  grades?: Record<string, Grade>;
  /** 그 밖의 문서는 등급 하나. */
  grade?: Grade;
}

/** Flow B의 끝. 개정을 기록한다. */
export function docRevise(
  repo: Repo,
  stage: Stage,
  featureArg: string | undefined,
  options: ReviseOptions,
): RecordResult {
  const feature = requireFeature(stage, featureArg);
  const doc = requireDoc(repo, stage, feature);
  const { version: previous, diff } = requireCreated(doc);
  const meta: Meta = { ...doc.meta };

  if (isUnchanged(diff)) throw new Refusal("바뀐 곳이 없다. 기록할 개정이 없다.");
  ensureGate(repo, stage, feature, options.acknowledged);
  assertNoDuplicateItems(doc);

  let grade: Grade;
  let items: Record<string, Grade> | undefined;
  if (hasItems(stage)) {
    items = checkItemGrades(diff, options.grades ?? {});
    grade = maxGrade(Object.values(items)) as Grade;
  } else {
    if (!options.grade) throw new Refusal("개정 등급이 필요하다: --grade major|minor|patch");
    grade = options.grade;
  }

  let checklist: LoadedDoc | undefined;
  if (stage === "spec" && feature) {
    applyDepends(repo, meta, options.depends);
    checklist = requireChecklist(repo, feature, doc);
  }
  refreshBases(repo, stage, feature, meta);

  const version = bumpVersion(previous, grade);
  meta.version = version;
  meta.updated = options.today;
  if (items) meta.revisions = [...(meta.revisions ?? []), { version, date: options.today, items }];

  writeDoc(repo, stage, feature, meta, doc.body);
  writeHashes(repo, stage, feature, { version, hashes: doc.current });
  if (checklist && feature) stampChecklist(repo, feature, checklist, version);

  return { version, grade, stale: staleDocs(repo, stage, feature) };
}

/** 인자의 항목이 CLI가 계산한 바뀐 항목과 정확히 같아야 한다. 에이전트가 항목을 빠뜨릴 수 없다. */
function checkItemGrades(diff: HashDiff, grades: Record<string, Grade>): Record<string, Grade> {
  const expected = [...diff.changed, ...diff.added, ...diff.removed];
  const missing = expected.filter((name) => !(name in grades));
  const extra = Object.keys(grades).filter((name) => !expected.includes(name));
  if (missing.length > 0) throw new Refusal(`등급이 빠진 항목이 있다: ${missing.join(", ")}`);
  if (extra.length > 0) throw new Refusal(`바뀌지 않은 항목에 등급을 매겼다: ${extra.join(", ")}`);

  const items: Record<string, Grade> = {};
  for (const name of expected) {
    const grade = grades[name];
    if (!isGrade(grade)) throw new Refusal(`등급이 아니다: ${name}=${String(grade)}`);
    if (diff.removed.includes(name) && grade !== "major") {
      throw new Refusal(`항목을 지우는 개정은 major다: ${name}`);
    }
    if (diff.added.includes(name) && !gradeAtLeast(grade, "minor")) {
      throw new Refusal(`새 항목은 minor 이상이다: ${name}`);
    }
    items[name] = grade;
  }
  return items;
}

export interface ConfirmResult {
  /** 기준 버전을 올린 상위 문서. */
  updated: string[];
}

/**
 * Flow C. 상위 개정이 이 문서에 영향을 주지 않는다는 확인을 기록한다. 자기 버전은 그대로다.
 * spec의 의존 항목만 고치는 것도 본문이 바뀌지 않으므로 여기서 한다.
 */
export function docConfirm(
  repo: Repo,
  stage: Stage,
  featureArg: string | undefined,
  options: { depends?: string[] } = {},
): ConfirmResult {
  const feature = requireFeature(stage, featureArg);
  const doc = requireDoc(repo, stage, feature);
  if (doc.unrecorded) throw new Refusal("본문이 바뀌었다. 영향 없음이 아니라 개정이다. doc revise로 기록한다.");

  const meta: Meta = { ...doc.meta };
  if (options.depends !== undefined && stage !== "spec") throw new Refusal("의존 항목은 spec에만 적는다");
  const before = JSON.stringify(meta.based_on ?? {});
  if (stage === "spec") applyDepends(repo, meta, options.depends);
  const updated = refreshBases(repo, stage, feature, meta);
  if (JSON.stringify(meta.based_on ?? {}) !== before) writeDoc(repo, stage, feature, meta, doc.body);
  return { updated };
}

export interface ChecklistResult {
  status: "pass" | "failed";
  checked: number;
  total: number;
}

const CHECK_LINE = /^\s*[-*] \[([ xX])\]/;

export function countChecks(body: string): { checked: number; total: number } {
  let checked = 0;
  let total = 0;
  for (const line of body.split("\n")) {
    const match = CHECK_LINE.exec(line);
    if (!match) continue;
    total += 1;
    if (match[1] !== " ") checked += 1;
  }
  return { checked, total };
}

/** 체크를 세어 checklist의 상태를 기록하고, 검증한 spec 본문의 해시를 남긴다. */
export function docChecklist(repo: Repo, featureArg: string | undefined): ChecklistResult {
  const feature = requireFeature("spec", featureArg) as string;
  const spec = requireDoc(repo, "spec", feature);
  const checklist = loadDoc(repo, "checklist", feature);
  if (!checklist) throw new Refusal("checklist가 없다");
  if (checklist.parsed.error) throw new Refusal(`${checklist.path}: ${checklist.parsed.error}`);

  const { checked, total } = countChecks(checklist.body);
  const status = total > 0 && checked === total ? "pass" : "failed";
  writeDoc(repo, "checklist", feature, { ...checklist.meta, status }, checklist.body);
  writeHashes(repo, "checklist", feature, { hashes: { [VERIFIED_SPEC]: spec.current[BODY] as string } });
  return { status, checked, total };
}

export interface StaleDoc extends RelationResult {
  feature: string;
}

/** 재실행이 필요한 하위 문서를 찾는다. prd와 constitution의 개정은 모든 feature에 걸린다. */
export function staleDocs(repo: Repo, stage: Stage, feature: string | undefined): StaleDoc[] {
  const features = feature ? [feature] : listFeatures(repo);
  const stale: StaleDoc[] = [];
  for (const name of features) {
    for (const result of judgeChain(toStates(loadDocs(repo, name)))) {
      if (result.verdict !== "match") stale.push({ ...result, feature: name });
    }
  }
  return stale;
}
