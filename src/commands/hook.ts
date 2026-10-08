import path from "node:path";
import { classifyPath, docsDir, type Repo } from "../core/repo.js";
import { wikiDir } from "../core/wiki.js";
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

export type HookScope = "wiki";

export function isHookScope(value: string): value is HookScope {
  return value === "wiki";
}

/**
 * 범위를 한정하는 쓰기 hook. 위키 스킬이 쓴다(구현 설계 「0.4 구현의 진행」).
 * `wiki`는 위키 아래만 허용하고, 그 밖의 산출물 디렉터리와 `.mob-sdd/`의 쓰기를 거부한다. 코드와 다른 파일은 막지 않는다.
 */
export function hookWriteScoped(repo: Repo, file: string, scope: HookScope): HookDecision {
  const target = path.resolve(file);
  const inside = (dir: string) => {
    const rel = path.relative(dir, target);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };
  if (scope === "wiki") {
    if (inside(wikiDir(repo))) return { allow: true };
    if (inside(docsDir(repo)) || inside(path.join(repo.root, ".mob-sdd"))) {
      return {
        allow: false,
        reason: `mob-sdd: 위키 스킬은 ${path.relative(repo.root, wikiDir(repo))}/ 아래만 쓴다. 다른 문서와 설정은 그 단계나 CLI가 고친다. 셸 명령으로 써서 피해 가지 말고 사용자에게 알린다.`,
      };
    }
  }
  return { allow: true };
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
