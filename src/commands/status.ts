import { judgeChain, type RelationResult } from "../core/chain.js";
import { countTasks, parseTasks } from "../core/breakdown.js";
import type { DocKind } from "../core/hash.js";
import { listFeatures, loadDoc, loadDocs, toStates, type LoadedDoc, type Repo } from "../core/repo.js";
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
  tasks?: { done: number; total: number };
  relations: RelationResult[];
}

export interface StatusResult {
  project: Partial<Record<DocKind, DocSummary>>;
  features: FeatureStatus[];
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
    if (docs.breakdown) feature.tasks = countTasks(parseTasks(docs.breakdown.body));
    features.push(feature);
  }
  return { project, features };
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
    if (feature.tasks) lines.push(`  작업: ${feature.tasks.done}/${feature.tasks.total}`);
    for (const relation of feature.relations) {
      if (relation.verdict === "match") continue;
      const kind = relation.gate ? "게이트" : "보고";
      lines.push(`  ${relation.lower} → ${relation.upper}: ${verdictText(relation.verdict)} (${kind})`);
    }
  }
  return lines.join("\n");
}
