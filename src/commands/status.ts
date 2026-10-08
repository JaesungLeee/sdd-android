import fs from "node:fs";
import { judgeChain, type RelationResult } from "../core/chain.js";
import { countTasks, FINAL_ID, parseTasks } from "../core/breakdown.js";
import { checkpointPath } from "../core/checkpoint.js";
import type { DocKind } from "../core/hash.js";
import { listFeatures, loadDoc, loadDocs, toStates, type LoadedDoc, type Repo } from "../core/repo.js";
import { wikiSummary } from "../core/wiki.js";
import { countChecks } from "./doc.js";
import { verdictText } from "./gate.js";

export interface DocSummary {
  status?: string;
  version?: string;
  /** 완료된 뒤 본문이 바뀌었다. */
  unrecorded: boolean;
  error?: string;
}

export interface FeatureStatus {
  name: string;
  docs: Partial<Record<DocKind, DocSummary>>;
  checklist?: { status?: string; checked: number; total: number };
  /** `final`은 마지막 확인 줄이 체크된 것, 곧 구현 완료다. `inProgress`는 체크포인트가 있는 것이다. */
  tasks?: { done: number; total: number; final: boolean; inProgress: boolean };
  relations: RelationResult[];
}

export interface StatusResult {
  project: Partial<Record<DocKind, DocSummary>>;
  features: FeatureStatus[];
  /** 위키가 있을 때만. 없는 저장소의 출력은 바뀌지 않는다(PRD §4 「확장」). */
  wiki?: { pages: number; stale: number; uncollected: number };
}

function summarize(doc: LoadedDoc): DocSummary {
  return {
    status: doc.meta.status,
    version: doc.meta.version,
    unrecorded: doc.unrecorded,
    ...(doc.parsed.error ? { error: doc.parsed.error } : {}),
  };
}

/** 어디까지 왔고 무엇이 뒤처졌는지를 답한다(PRD CLI-003). */
export function status(repo: Repo, only?: string): StatusResult {
  const project: StatusResult["project"] = {};
  for (const kind of ["constitution", "prd"] as const) {
    const doc = loadDoc(repo, kind);
    if (doc) project[kind] = summarize(doc);
  }

  const features: FeatureStatus[] = [];
  for (const name of only ? [only] : listFeatures(repo)) {
    const docs = loadDocs(repo, name);
    const feature: FeatureStatus = { name, docs: {}, relations: judgeChain(toStates(docs)) };
    for (const kind of ["spec", "blueprint", "breakdown"] as const) {
      const doc = docs[kind];
      if (doc) feature.docs[kind] = summarize(doc);
    }
    const checklist = loadDoc(repo, "checklist", name);
    if (checklist) feature.checklist = { status: checklist.meta.status, ...countChecks(checklist.body) };
    if (docs.breakdown) {
      const tasks = parseTasks(docs.breakdown.body);
      feature.tasks = {
        ...countTasks(tasks),
        final: tasks.some((task) => task.id === FINAL_ID && task.checked),
        inProgress: fs.existsSync(checkpointPath(repo, name)),
      };
    }
    features.push(feature);
  }
  const wiki = wikiSummary(repo);
  return { project, features, ...(wiki ? { wiki } : {}) };
}

function describeDoc(kind: string, doc: DocSummary | undefined): string {
  if (!doc) return `${kind}: 없음`;
  const version = doc.version ? ` ${doc.version}` : "";
  const flags = [doc.unrecorded ? "미기록 변경" : "", doc.error ?? ""].filter(Boolean).join(", ");
  return `${kind}: ${doc.status ?? "상태 없음"}${version}${flags ? ` (${flags})` : ""}`;
}

export function formatStatus(result: StatusResult): string {
  const lines: string[] = [];
  lines.push(describeDoc("constitution", result.project.constitution));
  lines.push(describeDoc("prd", result.project.prd));
  for (const feature of result.features) {
    lines.push("", `[${feature.name}]`);
    for (const kind of ["spec", "blueprint", "breakdown"] as const) {
      lines.push(`  ${describeDoc(kind, feature.docs[kind])}`);
    }
    if (feature.checklist) {
      const { status: state, checked, total } = feature.checklist;
      lines.push(`  checklist: ${state ?? "상태 없음"} (${checked}/${total})`);
    }
    if (feature.tasks) {
      const state = feature.tasks.final ? " (구현 완료)" : feature.tasks.inProgress ? " (구현 중)" : "";
      lines.push(`  작업: ${feature.tasks.done}/${feature.tasks.total}${state}`);
    }
    for (const relation of feature.relations) {
      if (relation.verdict === "match") continue;
      const kind = relation.gate ? "게이트" : "보고";
      lines.push(`  ${relation.lower} → ${relation.upper}: ${verdictText(relation.verdict)} (${kind})`);
    }
  }
  if (result.wiki) lines.push("", `위키: 페이지 ${result.wiki.pages}, 낡음 후보 ${result.wiki.stale}, 미수집 원본 ${result.wiki.uncollected}`);
  return lines.join("\n");
}
