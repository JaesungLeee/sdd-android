import type { BasedOn, Meta } from "./frontmatter.js";
import type { DocKind } from "./hash.js";
import { compareVersions, gradeBetween, isGrade, maxGrade, type Grade } from "./version.js";

/** 버전 체인 판정의 종류(PRD CLI-003). `upper-missing`은 상위 문서 파일이 없는 경우다. */
export type Verdict =
  | "match"
  | "behind-patch"
  | "behind-minor"
  | "behind-major"
  | "upper-unresolved"
  | "base-ahead"
  | "base-missing"
  | "unrecorded-change"
  | "upper-draft"
  | "upper-missing";

/** 판정별 처리(PRD SYS-001). `report`는 보고만 하는 관계에서 일치가 아닌 경우다. */
export type Action = "pass" | "confirm" | "block" | "report";

export interface DocState {
  meta: Meta;
  /** 기록된 해시와 현재 본문이 다르다. */
  unrecorded: boolean;
}

export interface Relation {
  lower: DocKind;
  upper: DocKind;
  /** 게이트 관계면 뒤처짐이 다음 단계를 막는다. 아니면 보고만 한다. */
  gate: boolean;
}

/** 사슬의 상·하위 관계(PRD SYS-006). 위에서 아래로 판정해야 전이 판정이 맞는다. */
export const RELATIONS: readonly Relation[] = [
  { lower: "spec", upper: "prd", gate: false },
  { lower: "blueprint", upper: "spec", gate: true },
  { lower: "blueprint", upper: "constitution", gate: false },
  { lower: "breakdown", upper: "blueprint", gate: true },
];

/**
 * 기준 버전 이후의 상위 개정이 하위 문서에 주는 뒤처짐 등급.
 * 개정 기록이 있는 상위(prd, constitution)는 항목별 등급으로, 없는 상위(spec, blueprint)는 버전 번호의 차이로 낸다.
 */
export function lagGrade(base: BasedOn, upper: Meta): Grade | null {
  if (!upper.version) return null;
  if (!upper.revisions) return gradeBetween(base.version, upper.version);

  const grades: Grade[] = [];
  for (const revision of upper.revisions) {
    if (compareVersions(revision.version, base.version) <= 0) continue;
    for (const [id, grade] of Object.entries(revision.items ?? {})) {
      if (!isGrade(grade)) continue;
      if (!base.items || id === "*" || base.items.includes(id)) grades.push(grade);
    }
  }
  return maxGrade(grades);
}

export function judgeRelation(lower: DocState, upperName: DocKind, upper: DocState | undefined): Verdict {
  if (!upper) return "upper-missing";
  if (upper.meta.status === "draft" || !upper.meta.version) return "upper-draft";

  const base = lower.meta.based_on?.[upperName];
  if (!base?.version) return "base-missing";
  if (compareVersions(base.version, upper.meta.version) > 0) return "base-ahead";

  const lag = lagGrade(base, upper.meta);
  if (lag === "major") return "behind-major";
  if (upper.unrecorded) return "unrecorded-change";
  if (lag === "minor") return "behind-minor";
  if (lag === "patch") return "behind-patch";
  return "match";
}

export function actionFor(verdict: Verdict, gate: boolean): Action {
  if (verdict === "match") return "pass";
  if (!gate) return "report";
  switch (verdict) {
    case "behind-patch":
      return "pass";
    case "behind-minor":
    case "unrecorded-change":
    case "base-missing":
      return "confirm";
    default:
      return "block";
  }
}

export interface RelationResult extends Relation {
  verdict: Verdict;
  action: Action;
}

const STALE: readonly Verdict[] = ["behind-minor", "behind-major", "upper-unresolved"];

/**
 * 한 feature의 문서들을 사슬의 관계대로 판정한다.
 * 게이트 관계에서 상위 문서가 뒤처져 있으면 하위에는 "상위 미해결"만 표시한다.
 * 조치는 맨 위의 뒤처진 문서에서만 하면 되기 때문이다.
 */
export function judgeChain(docs: Partial<Record<DocKind, DocState>>): RelationResult[] {
  const results: RelationResult[] = [];
  const stale = new Set<DocKind>();

  for (const relation of RELATIONS) {
    const lower = docs[relation.lower];
    if (!lower) continue;
    const upper = docs[relation.upper];
    // prd가 없으면 spec은 prd와의 관계를 갖지 않는다.
    if (!upper && !relation.gate && !lower.meta.based_on?.[relation.upper]) continue;

    let verdict = judgeRelation(lower, relation.upper, upper);
    if (relation.gate && stale.has(relation.upper) && verdict !== "upper-draft") {
      verdict = "upper-unresolved";
    }
    if (relation.gate && STALE.includes(verdict)) stale.add(relation.lower);

    results.push({ ...relation, verdict, action: actionFor(verdict, relation.gate) });
  }
  return results;
}
