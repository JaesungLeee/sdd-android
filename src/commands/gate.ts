import { judgeChain, RELATIONS, type Action, type RelationResult, type Verdict } from "../core/chain.js";
import type { DocKind } from "../core/hash.js";
import { isFeatureStage, listFeatures, loadDocs, toStates, type Repo, type Stage } from "../core/repo.js";

export interface GateReason {
  /** 문제가 있는 문서. */
  doc: DocKind;
  /** 그 문서가 무엇에 대해 뒤처졌는지. 문서 자신의 문제면 비운다. */
  against?: DocKind;
  verdict: Verdict;
  action: Action;
}

export interface GateResult {
  stage: Stage;
  feature?: string;
  /** 이 단계의 산출물이 지금 어떤 상태인지. */
  mode: "new" | "draft" | "revise";
  /** 단계를 시작해도 되는지. 가장 무거운 사유를 따른다. */
  action: "pass" | "confirm" | "block";
  /** 입력으로 삼는 상위 문서의 문제. */
  reasons: GateReason[];
  /** 이 단계의 산출물이 상위에 대해 뒤처진 정도. 이 단계가 풀 대상이라 막는 사유가 아니다. */
  own: RelationResult[];
}

const WEIGHT: Record<Action, number> = { pass: 0, report: 0, confirm: 1, block: 2 };

/**
 * 착수 게이트(PRD SYS-001). 뒤처진 문서를 입력으로 삼아 다음 문서를 만드는 일을 막는다.
 * 보는 것은 입력 문서의 상태다. 이 단계의 산출물 자신이 뒤처진 것은 이 단계가 푸는 일이다.
 */
export function stageGate(repo: Repo, stage: Stage, feature?: string): GateResult {
  const docs = loadDocs(repo, feature);
  const chain = judgeChain(toStates(docs));
  const target = docs[stage];
  const reasons: GateReason[] = [];

  for (const relation of RELATIONS) {
    if (relation.lower !== stage) continue;
    const upper = docs[relation.upper];
    const soften = (action: Action): Action => (relation.gate ? action : "report");

    if (!upper) {
      if (relation.gate) reasons.push({ doc: relation.upper, verdict: "upper-missing", action: "block" });
      continue;
    }
    if (upper.meta.status !== "created") {
      reasons.push({ doc: relation.upper, verdict: "upper-draft", action: soften("block") });
      continue;
    }
    if (upper.unrecorded) {
      reasons.push({ doc: relation.upper, verdict: "unrecorded-change", action: soften("confirm") });
    }
    // 입력 문서가 자신의 상위에 대해 뒤처져 있으면 그 입력으로는 진행할 수 없다.
    for (const result of chain) {
      if (result.lower !== relation.upper || !result.gate || result.action === "pass") continue;
      reasons.push({
        doc: relation.upper,
        against: result.upper,
        verdict: result.verdict,
        action: soften(result.action),
      });
    }
  }

  let action: GateResult["action"] = "pass";
  for (const reason of reasons) {
    if (WEIGHT[reason.action] > WEIGHT[action]) action = reason.action as GateResult["action"];
  }

  return {
    stage,
    feature,
    mode: !target ? "new" : target.meta.status === "created" ? "revise" : "draft",
    action,
    reasons,
    own: target ? chain.filter((result) => result.lower === stage) : [],
  };
}

/** 스킬 본문에 주입할 판정. feature 단계는 모든 feature의 판정을 준다. */
export function gateAll(repo: Repo, stage: Stage): GateResult[] {
  if (!isFeatureStage(stage)) return [stageGate(repo, stage)];
  return listFeatures(repo).map((feature) => stageGate(repo, stage, feature));
}

const VERDICT_TEXT: Record<Verdict, string> = {
  match: "일치",
  "behind-patch": "PATCH 뒤처짐",
  "behind-minor": "MINOR 뒤처짐",
  "behind-major": "MAJOR 뒤처짐",
  "upper-unresolved": "상위 미해결",
  "base-ahead": "기준 버전이 상위보다 높음",
  "base-missing": "기준 버전 비어 있음",
  "unrecorded-change": "미기록 변경",
  "upper-draft": "상위 미완료",
  "upper-missing": "상위 문서 없음",
};

const ACTION_TEXT: Record<GateResult["action"], string> = { pass: "통과", confirm: "확인 필요", block: "중단" };
const MODE_TEXT: Record<GateResult["mode"], string> = { new: "신규", draft: "작성 중", revise: "개정" };

export function verdictText(verdict: Verdict): string {
  return VERDICT_TEXT[verdict];
}

export function describeReason(reason: GateReason): string {
  const against = reason.against ? ` (${reason.against} 기준)` : "";
  return `${reason.doc}: ${VERDICT_TEXT[reason.verdict]}${against}`;
}

export function formatGate(results: GateResult[]): string {
  if (results.length === 0) return "feature가 없다.";
  const lines: string[] = [];
  for (const result of results) {
    const name = result.feature ?? result.stage;
    lines.push(`- ${name}: ${ACTION_TEXT[result.action]} (${MODE_TEXT[result.mode]})`);
    for (const reason of result.reasons) lines.push(`  - ${describeReason(reason)}`);
    for (const own of result.own) {
      if (own.verdict !== "match") lines.push(`  - 이 문서: ${own.upper}에 대해 ${VERDICT_TEXT[own.verdict]}`);
    }
  }
  return lines.join("\n");
}
