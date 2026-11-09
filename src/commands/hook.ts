import { classifyPath, type Repo } from "../core/repo.js";
import { describeReason, stageGate } from "./gate.js";

export interface HookDecision {
  allow: boolean;
  reason?: string;
}

/**
 * 스킬의 쓰기 hook이 부른다. 중단 판정일 때만 막는다.
 * 확인 필요는 스킬이 시작할 때 한 번 묻고 쓰기 명령의 인자로 넘기므로 여기서는 통과시킨다(PRD SYS-001).
 */
export function hookWrite(repo: Repo, file: string): HookDecision {
  const target = classifyPath(repo, file);
  if (!target) return { allow: true };

  const gate = stageGate(repo, target.stage, target.feature);
  if (gate.action !== "block") return { allow: true };

  const reasons = gate.reasons.filter((reason) => reason.action === "block").map(describeReason).join(", ");
  return {
    allow: false,
    reason: `mob-sdd: 중단. ${reasons}. 그 문서의 단계를 먼저 다시 실행한다. 다시 시도하거나 셸 명령으로 써서 피해 가지 말고, 막힌 사유를 사용자에게 알린다.`,
  };
}

/** Claude Code의 PreToolUse hook이 읽는 답. 막지 않을 때는 아무것도 내지 않는다. */
export function formatHookOutput(decision: HookDecision): string {
  if (decision.allow) return "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: decision.reason,
    },
  });
}
