import fs from "node:fs";
import path from "node:path";
import { FINAL_ID, liveTasks, parseTasks, validateTasks } from "../core/breakdown.js";
import { RELATIONS } from "../core/chain.js";
import { BODY, hasItems, OUTSIDE, type DocKind } from "../core/hash.js";
import { ITEM_ID_PATTERN, splitItems } from "../core/items.js";
import { LOCAL_CONFIG_FILE, readLocalConfig } from "../core/local-config.js";
import { hashContent, readManifest } from "../core/manifest.js";
import { listFeatures, loadDoc, type LoadedDoc, type Repo } from "../core/repo.js";
import { compareVersions, isGrade, isVersion } from "../core/version.js";
import { duplicateItems } from "./doc.js";
import { knownStages } from "./extension.js";
import { figmaStories } from "./impl.js";
import { bundleFromDir } from "../core/assets.js";
import { MANIFEST_FILE, readBundle } from "../core/extension.js";

export interface Problem {
  level: "error" | "warn";
  /** 문제가 있는 곳. 저장소 루트에서 본 경로다. */
  where: string;
  message: string;
}

export interface CheckResult {
  ok: boolean;
  problems: Problem[];
}

export const MIN_NODE_MAJOR = 22;

const DOC_STATUS = ["draft", "created"];
const CHECKLIST_STATUS = ["draft", "pass", "failed"];

/** 깨진 곳이 없는지를 답한다(PRD CLI-003). 오류가 하나라도 있으면 `ok`가 거짓이다. */
export function check(repo: Repo, nodeVersion: string = process.versions.node): CheckResult {
  const problems: Problem[] = [];
  const add = (level: Problem["level"], where: string, message: string) => problems.push({ level, where, message });

  if (Number(nodeVersion.split(".")[0]) < MIN_NODE_MAJOR) {
    add("error", "환경", `Node.js ${MIN_NODE_MAJOR} 이상이 필요하다(지금 ${nodeVersion})`);
  }
  checkInstall(repo, add);

  const project = { constitution: loadDoc(repo, "constitution"), prd: loadDoc(repo, "prd") };
  for (const doc of Object.values(project)) if (doc) checkDoc(repo, doc, add);

  for (const feature of listFeatures(repo)) {
    const docs: Partial<Record<DocKind, LoadedDoc>> = { ...dropUndefined(project) };
    for (const kind of ["spec", "blueprint", "breakdown"] as const) {
      const doc = loadDoc(repo, kind, feature);
      if (!doc) continue;
      docs[kind] = doc;
      checkDoc(repo, doc, add);
    }
    checkBases(repo, docs, add);
    if (docs.spec) checkChecklist(repo, feature, docs.spec, add);
    if (docs.breakdown && !docs.breakdown.parsed.error) {
      const tasks = parseTasks(docs.breakdown.body);
      const where = rel(repo, docs.breakdown.path);
      for (const message of validateTasks(tasks)) add("error", where, message);
      // 마지막 확인 줄은 모든 작업이 체크됐을 때만 체크된다. 작업이 더해지면 CLI가 함께 내린다.
      if (tasks.some((task) => task.id === FINAL_ID && task.checked) && liveTasks(tasks).some((task) => !task.checked)) {
        add("error", where, "마지막 확인 줄(FINAL)이 체크됐는데 체크되지 않은 작업이 있다");
      }
    }
  }

  return { ok: problems.every((problem) => problem.level !== "error"), problems };
}

type Add = (level: Problem["level"], where: string, message: string) => void;

function dropUndefined<T>(record: Record<string, T | undefined>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Record<string, T>;
}

function rel(repo: Repo, file: string): string {
  return path.relative(repo.root, file);
}

function checkInstall(repo: Repo, add: Add): void {
  const manifest = readManifest(repo.root);
  if (!manifest) {
    add("error", ".mob-sdd/manifest.json", "설치 기록이 없다");
    return;
  }
  for (const [file, entry] of Object.entries(manifest.files)) {
    const full = path.join(repo.root, file);
    if (!fs.existsSync(full)) add("error", file, "설치된 파일이 없다");
    else if (hashContent(fs.readFileSync(full)) !== entry.sha256) add("warn", file, "설치한 뒤 바뀐 파일이다");
  }
  // 확장의 선언이 있는지와, 지시의 대상 단계가 설치된 스킬인지.
  const stages = knownStages(repo, manifest);
  // spec에 Figma 줄이 있는 feature가 있으면 Figma 설정이 있어야 한다. 없으면 기본값으로 동작하지만 사람마다 다른 값이라 알린다(PRD SYS-006).
  // Figma를 쓰지 않는 저장소는 조용하다.
  if (!readLocalConfig(repo)?.figma) {
    const withFigma = listFeatures(repo).filter((feature) => figmaStories(loadDoc(repo, "spec", feature)?.body ?? "").size > 0);
    if (withFigma.length > 0) {
      add("warn", `.mob-sdd/${LOCAL_CONFIG_FILE}`, `${withFigma.join(", ")}의 spec에 Figma 줄이 있는데 Figma 설정이 없다. 기본값(desktop, figma-desktop)으로 동작한다. mob-sdd figma setup으로 정한다`);
    }
  }
  for (const name of Object.keys(manifest.extensions ?? {}).sort()) {
    const dir = path.join(repo.root, ".mob-sdd", "extensions", name);
    if (!fs.existsSync(path.join(dir, MANIFEST_FILE))) {
      add("error", `.mob-sdd/extensions/${name}/${MANIFEST_FILE}`, "설치된 확장의 선언 파일이 없다");
      continue;
    }
    for (const stage of Object.keys(readBundle(bundleFromDir(dir)).manifest.directives)) {
      if (!stages.has(stage)) add("warn", `.mob-sdd/extensions/${name}/${MANIFEST_FILE}`, `지시의 대상 단계가 설치되어 있지 않다: ${stage}`);
    }
  }
}

function checkDoc(repo: Repo, doc: LoadedDoc, add: Add): void {
  const where = rel(repo, doc.path);
  if (!doc.parsed.hasFrontmatter) return add("error", where, "frontmatter가 없다. doc new로 만든 문서가 아니다");
  if (doc.parsed.error) return add("error", where, doc.parsed.error);

  const { meta } = doc;
  if (!meta.status || !DOC_STATUS.includes(meta.status)) add("error", where, `status가 draft나 created가 아니다: ${meta.status}`);

  if (hasItems(doc.kind)) {
    for (const duplicate of duplicateItems(repo, doc)) {
      const dependents = duplicate.dependents.length > 0 ? ` 이 ID에 의존하는 문서: ${duplicate.dependents.join(", ")}` : "";
      add("error", where, `항목 ID가 중복됐다: ${duplicate.id}. 그 단계를 다시 실행해 들어온 쪽에 새 번호를 준다.${dependents}`);
    }
  }
  if (meta.status !== "created") return;

  if (!isVersion(meta.version)) return add("error", where, `version이 버전 형식이 아니다: ${String(meta.version)}`);
  if (!doc.recorded) add("error", where, "기록된 해시가 없다");
  else {
    if (doc.recorded.version !== meta.version) {
      add("error", where, `해시 파일의 버전(${doc.recorded.version})이 문서의 버전(${meta.version})과 다르다`);
    }
    if (doc.unrecorded) add("error", where, "미기록 변경: 버전을 올리지 않고 본문을 고쳤다. 그 단계를 다시 실행해 개정을 기록한다");
  }

  if (!hasItems(doc.kind)) return;
  const revisions = meta.revisions ?? [];
  if (revisions.length === 0) return add("error", where, "개정 기록이 없다");
  if (revisions[revisions.length - 1]?.version !== meta.version) {
    add("error", where, `version(${meta.version})이 개정 기록의 마지막 항목과 다르다`);
  }
  revisions.forEach((revision, index) => {
    const previous = revisions[index - 1];
    if (!isVersion(revision.version)) add("error", where, `개정 기록의 버전이 형식에 맞지 않는다: ${String(revision.version)}`);
    else if (previous && isVersion(previous.version) && compareVersions(previous.version, revision.version) >= 0) {
      add("error", where, `개정 기록의 버전이 순서대로가 아니다: ${previous.version} 다음에 ${revision.version}`);
    }
    for (const [id, grade] of Object.entries(revision.items ?? {})) {
      if (id !== OUTSIDE && !ITEM_ID_PATTERN.test(id)) add("error", where, `개정 기록의 항목 ID가 형식에 맞지 않는다: ${id}`);
      if (!isGrade(grade)) add("error", where, `개정 기록의 등급이 아니다: ${id}=${String(grade)}`);
    }
  });
}

/** 하위 문서의 기준 버전과 의존 항목이 상위 문서에 실제로 있는지 본다. */
function checkBases(repo: Repo, docs: Partial<Record<DocKind, LoadedDoc>>, add: Add): void {
  for (const relation of RELATIONS) {
    const lower = docs[relation.lower];
    const base = lower?.meta.based_on?.[relation.upper];
    if (!lower || lower.parsed.error || !base) continue;
    const where = rel(repo, lower.path);

    const upper = docs[relation.upper];
    if (!upper) {
      add("error", where, `기준으로 삼은 ${relation.upper} 문서가 없다`);
      continue;
    }
    if (!isVersion(base.version)) {
      add("error", where, `${relation.upper}의 기준 버전이 버전 형식이 아니다: ${String(base.version)}`);
      continue;
    }
    if (!isVersion(upper.meta.version)) continue;
    if (compareVersions(base.version, upper.meta.version) > 0) {
      add("error", where, `기준 버전(${base.version})이 ${relation.upper}의 버전(${upper.meta.version})보다 높다`);
    }
    if (!upper.meta.revisions) continue;

    if (!upper.meta.revisions.some((revision) => revision.version === base.version)) {
      add("error", where, `기준 버전(${base.version})이 ${relation.upper}의 개정 기록에 없다`);
    }
    const known = new Set(Object.keys(upper.current));
    for (const revision of upper.meta.revisions) for (const id of Object.keys(revision.items ?? {})) known.add(id);
    for (const id of base.items ?? []) {
      if (!known.has(id)) add("error", where, `의존 항목이 ${relation.upper}에 없던 ID다: ${id}`);
    }
  }
}

function checkChecklist(repo: Repo, feature: string, spec: LoadedDoc, add: Add): void {
  const checklist = loadDoc(repo, "checklist", feature);
  if (!checklist) {
    if (spec.meta.status === "created") add("error", rel(repo, spec.path), "완료된 spec에 checklist가 없다");
    return;
  }
  const where = rel(repo, checklist.path);
  if (checklist.parsed.error) return add("error", where, checklist.parsed.error);
  if (!checklist.meta.status || !CHECKLIST_STATUS.includes(checklist.meta.status)) {
    add("error", where, `status가 draft, pass, failed 가운데 하나가 아니다: ${checklist.meta.status}`);
  }
  if (spec.meta.status !== "created" || spec.unrecorded) return;
  if (checklist.meta.status !== "pass") add("error", where, "완료된 spec의 checklist가 pass가 아니다");
  else if (checklist.recorded?.hashes["verified-spec"] !== spec.current[BODY]) {
    add("error", where, "checklist가 지금의 spec 본문을 검증한 것이 아니다");
  }
}

export function formatCheck(result: CheckResult): string {
  if (result.problems.length === 0) return "문제가 없다.";
  const lines = result.problems.map((problem) => {
    const label = problem.level === "error" ? "오류" : "경고";
    return `[${label}] ${problem.where}: ${problem.message}`;
  });
  const errors = result.problems.filter((problem) => problem.level === "error").length;
  lines.push("", `오류 ${errors}개, 경고 ${result.problems.length - errors}개`);
  return lines.join("\n");
}
