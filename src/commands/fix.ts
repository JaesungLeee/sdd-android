import fs from "node:fs";
import path from "node:path";
import { FINAL_ID, FIX_ID, liveTasks, matchTasks, parseTasks, splitUnits, validateTasks, type Task } from "../core/breakdown.js";
import { checkpointPath } from "../core/checkpoint.js";
import { assertFeatureName, docPath, loadDoc, Refusal, type Repo } from "../core/repo.js";
import { skillName } from "../core/skilltext.js";
import { describeReason, stageGate } from "./gate.js";

/** 수정 단위의 작업 수 상한. 수정 작업 하나와 재현 테스트 하나다. 넘으면 작은 수정이 아니다. */
export const MAX_FIX_TASKS = 2;

/** 빌드 구성 파일. 의존성과 모듈의 구성을 바꾸는 수정은 작은 수정이 아니다. */
const BUILD_FILE = /(^|\/)(settings\.gradle(\.kts)?|[^/]*\.gradle(\.kts)?|gradle\.properties|[^/]*\.versions\.toml|package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/;

export interface FixCheckOptions {
  /** 재현 테스트 없이 가는 사유. 문구나 화면처럼 유닛 테스트로 재현할 동작이 없는 수정이다. */
  noTest?: string;
}

export interface FixCheckResult {
  feature: string;
  fix: string;
  tasks: string[];
  test?: string;
  noTest?: string;
}

function normalize(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** 기존 작업이 맡은 경로 안이거나, 기존 작업이 맡은 파일과 같은 디렉터리에 있는가. */
function insideExisting(existing: Task[], file: string): boolean {
  if (matchTasks(existing, file).length > 0) return true;
  const dir = path.posix.dirname(normalize(file));
  return existing.some((task) => task.paths.some((given) => !given.endsWith("/") && path.posix.dirname(normalize(given)) === dir));
}

/**
 * `/fix`가 더한 수정 단위가 작은 수정의 범위 안인지 판정한다. 사람이 고르지 않고 계산으로 정한다.
 * 범위를 넘으면 무엇이 넘었는지를 모아 거부한다. 그때는 정식 경로(spec, blueprint, breakdown의 개정)로 간다.
 * breakdown에 단위를 적은 뒤, 개정을 기록하기 전에 부른다.
 */
export function fixCheck(repo: Repo, feature: string, fix: string, options: FixCheckOptions = {}): FixCheckResult {
  assertFeatureName(feature);
  if (!FIX_ID.test(fix)) throw new Refusal(`수정 단위의 ID는 FIX-001 꼴이다: ${fix}`);
  const doc = loadDoc(repo, "breakdown", feature);
  if (!doc) throw new Refusal(`breakdown이 없다: ${docPath(repo, "breakdown", feature)}. 작은 수정은 구현이 끝난 feature에만 한다.`);
  if (doc.parsed.error) throw new Refusal(`${doc.path}: ${doc.parsed.error}`);
  const tasks = parseTasks(doc.body);
  const format = validateTasks(tasks);
  if (format.length > 0) throw new Refusal(`breakdown의 작업 줄에 문제가 있다.\n- ${format.join("\n- ")}`);

  const problems: string[] = [];
  if (doc.meta.status !== "created") problems.push("breakdown이 완료되지 않았다");
  if (!tasks.some((task) => task.id === FINAL_ID && task.checked)) problems.push("구현이 끝나지 않았다(FINAL이 체크되어 있지 않다). 구현 중인 feature는 평소처럼 breakdown을 개정한다");
  if (fs.existsSync(checkpointPath(repo, feature))) problems.push("진행 중인 구현이 있다(체크포인트가 있다)");

  // 상위 문서의 변경이 PATCH를 넘으면 breakdown의 게이트가 통과가 아니다. 정책이나 범위가 바뀐 것이라 작은 수정이 아니다.
  const gate = stageGate(repo, "breakdown", feature);
  if (gate.action !== "pass") {
    problems.push(`상위 문서가 breakdown의 게이트를 통과시키지 않는다: ${gate.reasons.filter((reason) => reason.action !== "pass" && reason.action !== "report").map(describeReason).join(", ")}. spec의 변경이 PATCH를 넘으면 작은 수정이 아니다`);
  }

  const unit = splitUnits(tasks).find((candidate) => candidate.name === fix);
  const own = unit?.tasks ?? [];
  if (own.length === 0) problems.push(`breakdown에 ${fix}의 작업이 없다`);
  if (own.length > MAX_FIX_TASKS) problems.push(`${fix}의 작업이 ${own.length}개다. 작은 수정은 ${MAX_FIX_TASKS}개까지다(수정 하나와 재현 테스트 하나)`);
  const checked = own.filter((task) => task.checked).map((task) => task.id);
  if (checked.length > 0) problems.push(`${fix}에 이미 체크된 작업이 있다: ${checked.join(", ")}. 새 수정에는 새 ID를 준다`);
  const outside = liveTasks(tasks).filter((task) => !task.checked && task.fix !== fix).map((task) => task.id);
  if (outside.length > 0) problems.push(`${fix} 밖에 체크되지 않은 작업이 있다: ${outside.join(", ")}`);

  const test = own.find((task) => task.until !== undefined && own.some((other) => other.id === task.until));
  if (!test && !options.noTest) problems.push(`${fix}에 재현 테스트([until:]이 단위 안의 작업을 가리키는 테스트 작업)가 없다. 유닛 테스트로 재현할 동작이 없는 수정(문구, 화면)이면 --no-test로 사유를 적는다`);
  if (test && options.noTest) problems.push("재현 테스트가 있는데 --no-test를 주었다. 둘 중 하나만 한다");

  const existing = liveTasks(tasks).filter((task) => task.fix !== fix);
  for (const task of own) {
    for (const file of task.paths) {
      if (file.endsWith("/")) problems.push(`${task.id}의 경로가 디렉터리다: ${file}. 작은 수정은 고칠 파일을 하나씩 적는다`);
      else if (BUILD_FILE.test(normalize(file))) problems.push(`${task.id}가 빌드 구성을 고친다: ${file}. 의존성이나 모듈 구성의 변경은 작은 수정이 아니다`);
      // 테스트 작업은 새 테스트 파일을 만들 수 있다. 구현 작업만 기존 작업의 경로에 묶는다.
      else if (task.until === undefined && !insideExisting(existing, file)) problems.push(`${task.id}의 경로가 기존 작업이 맡은 곳 밖이다: ${file}`);
    }
  }

  if (problems.length > 0) {
    const skill = (name: string) => `/${skillName(name, repo.config.prefix)}`;
    throw new Refusal(
      `${fix}는 작은 수정의 범위를 넘는다.\n- ${problems.join("\n- ")}\n더한 수정 단위를 breakdown에서 지우고, 정식 경로(필요하면 ${skill("spec")}, ${skill("blueprint")}, 그리고 ${skill("breakdown")}의 개정)로 진행한다.`,
    );
  }
  return { feature, fix, tasks: own.map((task) => task.id), ...(test ? { test: test.id } : {}), ...(options.noTest ? { noTest: options.noTest } : {}) };
}

/** `prefix`는 설치할 때 정한 스킬 이름 접두사다. 안내하는 스킬 이름에 붙인다. */
export function formatFixCheck(result: FixCheckResult, prefix = ""): string {
  const lines = [`${result.fix}: 작은 수정의 범위 안이다 (작업 ${result.tasks.join(", ")})`];
  lines.push(result.test ? `재현 테스트: ${result.test}` : `재현 테스트 없음: ${result.noTest}`);
  lines.push(`다음: sdd-android doc revise breakdown ${result.feature} --grade minor로 개정을 기록하고, /${skillName("impl-orchestrator", prefix)} ${result.feature} --fix ${result.fix}로 구현한다.`);
  return lines.join("\n");
}
