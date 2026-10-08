import fs from "node:fs";
import path from "node:path";
import {
  FINAL_ID,
  liveTasks,
  matchTasks,
  parseTasks,
  setChecked,
  splitUnits,
  unitOf,
  validateTasks,
  type Task,
  type Unit,
} from "../core/breakdown.js";
import {
  emptyCheckpoint,
  isCheck,
  isCheckResult,
  isKind,
  KINDS,
  MAX_ROUNDS,
  readCheckpoint,
  removeCheckpoint,
  writeCheckpoint,
  type Check,
  type Checkpoint,
  type CheckResult,
  type Kind,
  type Phase,
  type TaskRecord,
} from "../core/checkpoint.js";
import { assertFeatureName, docPath, loadDoc, loadDocs, Refusal, writeDoc, writeFile, type LoadedDoc, type Repo } from "../core/repo.js";
import { currentVersions, describeReason, implementGate, type GateResult } from "./gate.js";

const CHECK_TEXT: Record<Check, string> = { build: "빌드", lint: "Lint", test: "테스트", design: "디자인", principles: "원칙" };

interface Context {
  feature: string;
  doc: LoadedDoc;
  tasks: Task[];
  units: Unit[];
  checkpoint: Checkpoint;
}

function requireBreakdown(repo: Repo, feature: string): { doc: LoadedDoc; tasks: Task[] } {
  assertFeatureName(feature);
  const doc = loadDoc(repo, "breakdown", feature);
  if (!doc) throw new Refusal(`breakdown이 없다: ${docPath(repo, "breakdown", feature)}`);
  if (doc.parsed.error) throw new Refusal(`${doc.path}: ${doc.parsed.error}`);
  const tasks = parseTasks(doc.body);
  const problems = validateTasks(tasks);
  if (problems.length > 0) throw new Refusal(`breakdown의 작업 줄에 문제가 있다. breakdown 단계를 다시 실행한다.\n- ${problems.join("\n- ")}`);
  return { doc, tasks };
}

function load(repo: Repo, feature: string): Context {
  const { doc, tasks } = requireBreakdown(repo, feature);
  const checkpoint = readCheckpoint(repo, feature);
  if (!checkpoint) throw new Refusal("진행 중인 구현이 없다. impl start로 착수 게이트를 확인하고 시작한다.");
  return { feature, doc, tasks, units: splitUnits(tasks), checkpoint };
}

function save(repo: Repo, context: Context): void {
  writeCheckpoint(repo, context.feature, context.checkpoint);
}

function findTask(context: Context, id: string): Task {
  const task = liveTasks(context.tasks).find((candidate) => candidate.id === id);
  if (!task) throw new Refusal(`breakdown에 없거나 폐기된 작업이다: ${id}`);
  return task;
}

function record(context: Context, id: string): TaskRecord {
  return (context.checkpoint.tasks[id] ??= {});
}

/** 체크를 올리거나 내려 breakdown을 쓴다. 체크는 해시에 들어가지 않으므로 미기록 변경이 되지 않는다. */
function writeChecks(repo: Repo, context: Context, ids: string[], checked: boolean): void {
  if (ids.length === 0) return;
  const body = setChecked(context.doc.body, ids, checked);
  writeDoc(repo, "breakdown", context.feature, context.doc.meta, body);
  context.doc = { ...context.doc, body };
  context.tasks = parseTasks(body);
}

function finalChecked(context: Context): boolean {
  return context.tasks.some((task) => task.id === FINAL_ID && task.checked);
}

/**
 * 건너뜀이 통과를 대신할 수 있는 검사. 디자인은 기기나 Figma가 없는 환경에서도 feature를 끝낼 수 있어야 하고,
 * Lint는 프로젝트에 도구가 없을 수 있다. 빌드와 테스트의 건너뜀은 환경 문제이므로 체크를 올리지 못한다.
 */
const SKIPPABLE: readonly Check[] = ["design", "lint", "principles"];

function satisfied(kind: Check, result: CheckResult | undefined): boolean {
  return result === "pass" || (result === "skip" && SKIPPABLE.includes(kind));
}

/**
 * 그 작업을 체크하기 위해 통과해야 하는 검사. 테스트는 그 작업을 가리키는 테스트 작업이 이미 쓰여 있을 때다
 * (검증 대기 중이거나 체크된 것). 치유로 내려간 작업을 다시 올릴 때도 연결된 테스트를 다시 돌린다.
 */
export function requiredChecks(context: Context, task: Task): Check[] {
  const required: Check[] = ["build", "lint"];
  if (testsOn(context, task.id).length > 0) required.push("test");
  if (context.checkpoint.assignments[task.id] === "ui") required.push("design");
  return required;
}

/** 그 작업을 가리키는 테스트 작업 가운데 쓰여 있는 것. 아직 만들지 않은 테스트(체크도 대기도 아님)는 돌릴 수 없다. */
function testsOn(context: Context, id: string): Task[] {
  return liveTasks(context.tasks).filter((task) => task.until === id && (task.checked || context.checkpoint.waiting.includes(task.id)));
}

function testsWaitingOn(context: Context, id: string): Task[] {
  return liveTasks(context.tasks).filter((task) => task.until === id && context.checkpoint.waiting.includes(task.id));
}

/**
 * 체크를 내린다. 마지막 확인 줄도 함께 내린다. 내린 작업의 검사 기록은 지우고 시도 횟수는 남긴다.
 * 내린 작업은 다시 만들 것이 아니라 다시 검증할 것이므로 상태는 `done`으로 둔다(이어서 실행하면 verify 단계부터).
 * 테스트 작업이 내려가면 검증 대기로 돌아가고, 그 테스트가 가리키는 구현 작업도 함께 내려 그 게이트에서 테스트가 다시 돈다.
 * 체크되지 않은 작업은 내릴 것이 없으므로 그대로 둔다.
 */
function lower(repo: Repo, context: Context, ids: string[]): string[] {
  const expanded = new Set<string>();
  for (const id of ids) {
    expanded.add(id);
    const until = context.tasks.find((task) => task.id === id)?.until;
    if (until) expanded.add(until);
  }
  const lowered = [...expanded].filter((id) => context.tasks.some((task) => task.id === id && task.checked));
  const final = finalChecked(context) ? [FINAL_ID] : [];
  writeChecks(repo, context, [...lowered, ...final], false);
  for (const id of lowered) {
    const rec = record(context, id);
    delete rec.checks;
    rec.status = "done";
    const isTest = context.tasks.find((task) => task.id === id)?.until !== undefined;
    context.checkpoint.waiting = context.checkpoint.waiting.filter((waiting) => waiting !== id);
    if (isTest) context.checkpoint.waiting.push(id);
    // 그 작업이 속한 단위의 검증 기록도 지운다. 치유로 코드가 바뀌었으니 단위를 다시 본다.
    const unit = unitOf(context.units, id);
    if (unit) delete context.checkpoint.units[unit.name];
  }
  return lowered;
}

/** 작업의 체크를 올린다. 이 작업이 끝나기를 기다리던 테스트 작업은 테스트가 통과했으면 함께 올린다. */
function raise(repo: Repo, context: Context, task: Task): string[] {
  const rec = record(context, task.id);
  const tests = rec.checks?.test === "pass" ? testsWaitingOn(context, task.id).map((test) => test.id) : [];
  const ids = [task.id, ...tests];
  writeChecks(repo, context, ids, true);
  context.checkpoint.waiting = context.checkpoint.waiting.filter((waiting) => !tests.includes(waiting));
  for (const id of tests) record(context, id).checks = { ...record(context, id).checks, test: "pass" };
  return ids;
}

// ---------------------------------------------------------------------------
// 실패 기록 (docs/specs/{feature}/failures.md)

export type FailureState = "healed" | "handed" | "final";

const STATE_TEXT: Record<FailureState, string> = { healed: "치유됨", handed: "사람에게 넘김", final: "마지막 확인에서 남음" };
const RESULT_TEXT: Record<CheckResult, string> = { pass: "통과", fail: "실패", skip: "건너뜀" };

export interface FailureEntry {
  date: string;
  task?: string;
  kind: Check;
  symptom: string;
  rounds: { note: string; result?: CheckResult }[];
  files: string[];
  state: FailureState;
}

export function failuresPath(repo: Repo, feature: string): string {
  return path.join(path.dirname(docPath(repo, "breakdown", feature)), "failures.md");
}

/** 실패를 덧붙인다. 추가만 하고 지우지 않는다(PRD STG-007 「실패 기록」). */
export function appendFailure(repo: Repo, feature: string, entry: FailureEntry): void {
  const file = failuresPath(repo, feature);
  const head = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\n*$/, "\n") : `# 실패 기록: ${feature}\n\n구현 단계의 실패를 CLI가 덧붙인다. 지우거나 고치지 않는다.\n`;
  const lines = [
    "",
    `## ${entry.date} · ${entry.task ?? "작업 없음"} · ${CHECK_TEXT[entry.kind]} · ${STATE_TEXT[entry.state]}`,
    "",
    `- **증상**: ${entry.symptom}`,
  ];
  if (entry.rounds.length > 0) {
    lines.push("- **시도**:");
    entry.rounds.forEach((round, index) => lines.push(`    ${index + 1}. ${round.note} → ${round.result ? RESULT_TEXT[round.result] : "미검증"}`));
  }
  if (entry.files.length > 0) lines.push(`- **파일**: ${entry.files.map((name) => `\`${name}\``).join(", ")}`);
  writeFile(file, head + lines.join("\n") + "\n");
}

function recordFailure(repo: Repo, context: Context, id: string | undefined, kind: Check, state: FailureState, today: string, files: string[] = [], symptom?: string): void {
  const attempts = id ? context.checkpoint.tasks[id]?.attempts?.[kind] : undefined;
  appendFailure(repo, context.feature, {
    date: today,
    ...(id ? { task: id } : {}),
    kind,
    symptom: symptom ?? attempts?.symptom ?? "(증상 없음)",
    rounds: attempts?.rounds ?? [],
    files: files.length > 0 ? files : (id ? (context.checkpoint.tasks[id]?.files ?? []) : []),
    state,
  });
}

// ---------------------------------------------------------------------------
// start

export interface StartOptions {
  today: string;
  acknowledged?: boolean;
}

export interface StartResult extends GateResult {
  confirmed: boolean;
  versions: Record<string, string>;
  /** 이어서 실행하는지. */
  resumed: boolean;
  checkpoint: Checkpoint;
}

/**
 * 착수 게이트를 확인하고 결정과 문서 버전을 체크포인트에 적는다(구현 단계 스킬 구성 §2 흐름 1).
 * 체크포인트가 있고 버전이 같으면 묻지 않는다. 버전이 달라졌으면 다시 판정하고 버전을 갱신한다.
 */
export function implStart(repo: Repo, feature: string, options: StartOptions): StartResult {
  requireBreakdown(repo, feature);
  const gate = implementGate(repo, feature);
  if (gate.mode === "done") throw new Refusal("마지막 확인 줄이 체크되어 있다. 이 feature의 구현은 끝났다. 작업을 더하려면 breakdown을 개정한다.");
  const reasons = gate.reasons.filter((reason) => reason.action === gate.action).map(describeReason).join(", ");
  if (gate.action === "block") throw new Refusal(`중단: ${reasons}. 그 문서의 단계를 먼저 다시 실행한다.`);
  if (gate.action === "confirm" && !options.acknowledged) {
    throw new Refusal(`확인 필요: ${reasons}. 사용자가 계속하기로 했으면 --acknowledged를 붙인다.`);
  }

  const versions = currentVersions(loadDocs(repo, feature));
  const existing = readCheckpoint(repo, feature);
  const decision = gate.confirmed ? existing!.started.decision : options.acknowledged && gate.action === "confirm" ? "acknowledged" : "pass";
  const checkpoint = existing ? { ...existing, started: { decision, versions } } : emptyCheckpoint(decision, versions);
  if (!existing) {
    // 새 체크포인트에서 이미 끝나 있는 단위는 다시 검증하지 않는다. 마지막 확인이 feature 전체를 다시 본다.
    const { tasks } = requireBreakdown(repo, feature);
    for (const unit of splitUnits(tasks)) {
      if (unit.tasks.length > 0 && unit.tasks.every((task) => task.checked)) checkpoint.units[unit.name] = { checks: { principles: "skip" } };
    }
  }
  writeCheckpoint(repo, feature, checkpoint);
  return { ...gate, versions, resumed: existing !== undefined, checkpoint };
}

// ---------------------------------------------------------------------------
// assign

export interface AssignResult {
  assignments: Record<string, Kind>;
  /** 이번에 새로 배정한 작업. */
  added: string[];
}

/** 배정을 기록한다. 체크되지 않은 모든 작업에 종류가 있어야 하고, 연결 표기가 있는 작업은 `test`여야 한다. */
export function implAssign(repo: Repo, feature: string, pairs: string[]): AssignResult {
  const context = load(repo, feature);
  const added: string[] = [];
  for (const pair of pairs) {
    const [id, kind] = pair.split("=");
    if (!id || !kind) throw new Refusal(`배정은 작업ID=종류 꼴이다: ${pair}`);
    if (!isKind(kind)) throw new Refusal(`종류는 ${KINDS.join(", ")} 가운데 하나다: ${pair}`);
    const task = findTask(context, id);
    if (task.until !== undefined && kind !== "test") throw new Refusal(`${id}는 연결 표기가 있는 테스트 작업이라 test여야 한다`);
    if (context.checkpoint.assignments[id] !== kind) added.push(id);
    context.checkpoint.assignments[id] = kind;
  }
  // 체크된 작업도 뒤의 검증이 체크를 내릴 수 있으므로 종류가 있어야 한다.
  const unassigned = liveTasks(context.tasks).filter((task) => !context.checkpoint.assignments[task.id]).map((task) => task.id);
  if (unassigned.length > 0) throw new Refusal(`배정이 없는 작업이 있다: ${unassigned.join(", ")}. 체크된 작업을 포함해 모든 작업에 종류를 준다.`);
  save(repo, context);
  return { assignments: context.checkpoint.assignments, added };
}

// ---------------------------------------------------------------------------
// next

export interface NextTask {
  id: string;
  kind?: Kind;
  story?: string;
  paths: string[];
  until?: string;
  line: number;
  phase: Phase;
  /** 사람에게 넘긴 작업이다. 다시 시도할지 묻고 impl reset으로 초기화한 뒤 진행한다. */
  handed: boolean;
}

export interface NextResult {
  feature: string;
  /** 마지막 확인 줄이 체크되어 있다. */
  done: boolean;
  /** 모든 작업이 체크되어 마지막 확인 차례다. */
  final: boolean;
  task?: NextTask;
  /** 배정이 없는 작업. 있으면 impl assign을 먼저 한다. */
  unassigned: string[];
  /** 이 작업이 끝나면 돌릴 수 있는 테스트 작업. */
  testable: string[];
  unit?: string;
  /** 이 작업이 단위의 마지막 작업이다. 끝나면 단위 검증을 한다. */
  unitEnd: boolean;
  /** 작업은 모두 체크됐지만 단위 검증이 기록되지 않은 단위. 다음 작업보다 먼저 검증한다. */
  pendingUnit?: string;
  waiting: string[];
  handed: string[];
}

/** 다음 작업을 돌려준다. 문서 순서로 체크되지 않은 첫 작업이다(구현 설계 「breakdown의 작업 줄 형식」). */
export function implNext(repo: Repo, feature: string): NextResult {
  const context = load(repo, feature);
  const { checkpoint, units } = context;
  const live = liveTasks(context.tasks);
  const base: NextResult = {
    feature,
    done: finalChecked(context),
    final: false,
    unassigned: live.filter((task) => !checkpoint.assignments[task.id]).map((task) => task.id),
    testable: [],
    unitEnd: false,
    waiting: checkpoint.waiting,
    handed: checkpoint.handed,
  };
  const pending = units.find((unit) => unit.tasks.length > 0 && unit.tasks.every((task) => task.checked) && !checkpoint.units[unit.name]?.checks);
  if (pending) base.pendingUnit = pending.name;
  if (base.done) return base;

  // 검증 대기인 테스트 작업은 연결된 구현 작업이 끝날 때 함께 체크되므로 건너뛴다.
  const next = live.find((task) => !task.checked && !checkpoint.waiting.includes(task.id));
  if (!next) {
    base.final = checkpoint.waiting.length === 0;
    return base;
  }
  const unit = unitOf(units, next.id);
  const handed = checkpoint.handed.includes(next.id);
  // 진행 중이던 단계가 있으면 그것, 보고가 끝났는데 체크가 없으면(내려간 작업) 다시 검증, 아니면 처음부터.
  const phase: Phase =
    checkpoint.current?.task === next.id ? checkpoint.current.phase : checkpoint.tasks[next.id]?.status === "done" ? "verify" : "create";
  if (!handed && checkpoint.current?.task !== next.id) {
    checkpoint.current = { task: next.id, phase };
    save(repo, context);
  }
  return {
    ...base,
    task: {
      id: next.id,
      ...(checkpoint.assignments[next.id] ? { kind: checkpoint.assignments[next.id] } : {}),
      ...(next.story ? { story: next.story } : {}),
      paths: next.paths,
      ...(next.until ? { until: next.until } : {}),
      line: next.line,
      phase,
      handed,
    },
    testable: testsOn(context, next.id).map((task) => task.id),
    ...(unit ? { unit: unit.name } : {}),
    unitEnd: unit !== undefined && unit.tasks.every((task) => task.checked || task.id === next.id || checkpoint.waiting.includes(task.id)),
  };
}

// ---------------------------------------------------------------------------
// report

export interface ReportOptions {
  today: string;
  status: "done" | "blocked" | "handed";
  modules?: string[];
  files?: string[];
  /** UI 작업이 만든 프리뷰 함수의 전체 이름. */
  previews?: string[];
  failure?: Check;
  symptom?: string;
  note?: string;
}

export interface ReportResult {
  task: string;
  status: ReportOptions["status"];
  /** 테스트 작업이라 검증 대기로 두었다. 검증 없이 다음 작업으로 간다. */
  waiting: boolean;
  /** 다음에 돌릴 검사. 검증 대기나 막힘이면 비어 있다. */
  required: Check[];
}

/** 구현이나 치유 스킬의 보고를 적는다. 체크는 올리지 않는다. 체크는 검증 통과가 기록된 뒤에만 올라간다. */
export function implReport(repo: Repo, feature: string, id: string, options: ReportOptions): ReportResult {
  const context = load(repo, feature);
  const task = findTask(context, id);
  const rec = record(context, id);
  const { checkpoint } = context;

  if (options.status === "handed") {
    if (!options.failure || !options.symptom) throw new Refusal("사람에게 넘길 때는 --failure와 --symptom이 필요하다");
    rec.status = "handed";
    if (!checkpoint.handed.includes(id)) checkpoint.handed.push(id);
    delete checkpoint.current;
    recordFailure(repo, context, id, options.failure, "handed", options.today, options.files ?? [], options.symptom);
    save(repo, context);
    return { task: id, status: "handed", waiting: false, required: [] };
  }
  if (options.status === "blocked") {
    rec.status = "blocked";
    delete checkpoint.current;
    save(repo, context);
    return { task: id, status: "blocked", waiting: false, required: [] };
  }

  rec.status = "done";
  if (options.modules) rec.modules = options.modules;
  if (options.files) rec.files = options.files;
  if (options.previews) rec.previews = options.previews;
  if (task.until !== undefined) {
    // 테스트 작업은 red를 확인한 것만으로 체크하지 않는다. 연결된 구현 작업의 테스트 게이트에서 함께 판정한다.
    if (!checkpoint.waiting.includes(id)) checkpoint.waiting.push(id);
    delete checkpoint.current;
    save(repo, context);
    return { task: id, status: "done", waiting: true, required: [] };
  }
  checkpoint.current = { task: id, phase: "verify" };
  save(repo, context);
  return { task: id, status: "done", waiting: false, required: requiredChecks(context, task) };
}

// ---------------------------------------------------------------------------
// verify

export interface VerifyOptions {
  today: string;
  checks: Partial<Record<Check, CheckResult>>;
  files?: string[];
  /** 작업이 아니라 단위(스토리)의 검증이면 단위 이름. */
  unit?: string;
}

export interface VerifyResult {
  task?: string;
  unit?: string;
  checks: Partial<Record<Check, CheckResult>>;
  /** 체크를 올린 작업. */
  raised: string[];
  /** 체크를 내린 작업. */
  lowered: string[];
  /** 실패를 다시 고칠 작업과 종류. 치유 전에 impl attempt로 시도를 센다. */
  redo: { id: string; kind?: Kind; failure: Check }[];
  /** 어느 작업의 경로에도 맞지 않은 파일. 작업 없는 실패라 사람에게 넘긴다. */
  unmatched: string[];
  /** 아직 돌리지 않은 검사. */
  missing: Check[];
  /** 두 번 이상 시도한 끝에 치유된 실패를 기록했다. */
  healed: Check[];
  /** 건너뜀으로는 체크를 올릴 수 없는 검사. 환경을 고쳐 다시 돌려야 한다. */
  blockedBySkip: Check[];
}

export function parseChecks(values: string[]): Partial<Record<Check, CheckResult>> {
  const checks: Partial<Record<Check, CheckResult>> = {};
  for (const value of values) {
    const [kind, result] = value.split("=");
    if (!kind || !result || !isCheck(kind) || !isCheckResult(result)) {
      throw new Refusal(`검사는 종류=결과 꼴이다(종류: build, lint, test, design, principles; 결과: pass, fail, skip): ${value}`);
    }
    checks[kind] = result;
  }
  if (Object.keys(checks).length === 0) throw new Refusal("검사 결과가 필요하다: --check build=pass");
  return checks;
}

function fillRound(rec: TaskRecord, kind: Check, result: CheckResult): void {
  const rounds = rec.attempts?.[kind]?.rounds;
  const last = rounds?.[rounds.length - 1];
  if (last && last.result === undefined) last.result = result;
}

function matchFiles(context: Context, files: string[]): { matched: Map<string, string[]>; unmatched: string[] } {
  const matched = new Map<string, string[]>();
  const unmatched: string[] = [];
  for (const file of files) {
    const found = matchTasks(context.tasks, file);
    if (found.length === 0) unmatched.push(file);
    for (const task of found) matched.set(task.id, [...(matched.get(task.id) ?? []), file]);
  }
  return { matched, unmatched };
}

/** 검증 결과를 적는다. 통과가 다 모이면 체크를 올리고, 실패는 대응 작업의 체크를 내리고 다시 고칠 작업을 돌려준다. */
export function implVerify(repo: Repo, feature: string, id: string | undefined, options: VerifyOptions): VerifyResult {
  const context = load(repo, feature);
  if (id === undefined) return verifyUnit(repo, context, options);
  const task = findTask(context, id);
  if (context.checkpoint.waiting.includes(id)) {
    throw new Refusal(`${id}는 검증 대기인 테스트 작업이다. 연결된 구현 작업 ${task.until}의 테스트 게이트에서 함께 판정한다.`);
  }
  const rec = record(context, id);
  rec.checks = { ...rec.checks, ...options.checks };
  const gateTests = testsOn(context, id);
  for (const [kind, result] of Object.entries(options.checks) as [Check, CheckResult][]) {
    fillRound(rec, kind, result);
    if (kind === "test") for (const test of gateTests) fillRound(record(context, test.id), kind, result);
  }

  const result: VerifyResult = { task: id, checks: rec.checks, raised: [], lowered: [], redo: [], unmatched: [], missing: [], healed: [], blockedBySkip: [] };
  const failed = (Object.entries(options.checks) as [Check, CheckResult][]).filter(([, value]) => value === "fail").map(([kind]) => kind);

  if (failed.length > 0) {
    const { matched, unmatched } = matchFiles(context, options.files ?? []);
    result.unmatched = unmatched;
    result.lowered = lower(repo, context, [...matched.keys()].filter((other) => other !== id));
    for (const kind of failed) {
      // 테스트 게이트의 실패는 테스트 작업에 매긴다. 파일이 게이트의 테스트 작업을 가리키면 그것만, 아니면(구현 파일만 지목했거나 파일이 없으면) 게이트의 테스트 모두다.
      const named = gateTests.filter((test) => matched.has(test.id));
      const targets = kind === "test" ? (named.length > 0 ? named : gateTests).map((test) => test.id) : [id, ...result.lowered];
      for (const target of targets) result.redo.push({ id: target, kind: context.checkpoint.assignments[target], failure: kind });
    }
    context.checkpoint.current = { task: id, phase: "heal" };
    save(repo, context);
    return result;
  }

  result.missing = requiredChecks(context, task).filter((kind) => !satisfied(kind, rec.checks?.[kind]));
  result.blockedBySkip = result.missing.filter((kind) => rec.checks?.[kind] === "skip");
  if (result.missing.length === 0) {
    result.raised = raise(repo, context, task);
    for (const [kind, attempts] of Object.entries(rec.attempts ?? {}) as [Check, { rounds: unknown[] }][]) {
      if (attempts.rounds.length >= 2 && rec.checks?.[kind] === "pass") {
        recordFailure(repo, context, id, kind, "healed", options.today);
        result.healed.push(kind);
      }
    }
    delete context.checkpoint.current;
  }
  save(repo, context);
  return result;
}

function verifyUnit(repo: Repo, context: Context, options: VerifyOptions): VerifyResult {
  const name = options.unit;
  if (!name) throw new Refusal("작업 ID가 없으면 --unit <단위 이름>이 필요하다");
  if (!context.units.some((unit) => unit.name === name)) {
    throw new Refusal(`없는 단위다: ${name}. 단위는 ${context.units.map((unit) => unit.name).join(", ")}이다.`);
  }
  const unit = (context.checkpoint.units[name] ??= {});
  unit.checks = { ...unit.checks, ...options.checks };
  const result: VerifyResult = { unit: name, checks: unit.checks, raised: [], lowered: [], redo: [], unmatched: [], missing: [], healed: [], blockedBySkip: [] };
  const failed = (Object.entries(options.checks) as [Check, CheckResult][]).filter(([, value]) => value === "fail").map(([kind]) => kind);
  if (failed.length > 0) {
    const { matched, unmatched } = matchFiles(context, options.files ?? []);
    result.unmatched = unmatched;
    result.lowered = lower(repo, context, [...matched.keys()]);
    for (const kind of failed) {
      for (const id of matched.keys()) result.redo.push({ id, kind: context.checkpoint.assignments[id], failure: kind });
    }
    // 실패한 단위는 다시 검증해야 하므로 기록을 비운다.
    delete context.checkpoint.units[name];
  }
  save(repo, context);
  return result;
}

// ---------------------------------------------------------------------------
// attempt

export interface AttemptOptions {
  today: string;
  failure: Check;
  symptom?: string;
  note: string;
}

export interface AttemptResult {
  task: string;
  failure: Check;
  /** 이번 회차. 1부터 센다. */
  round: number;
  remaining: number;
}

/** 치유 직전에 시도를 센다. 같은 작업의 같은 실패 종류에 대한 네 번째는 거부하고 사람에게 넘긴다. */
export function implAttempt(repo: Repo, feature: string, id: string, options: AttemptOptions): AttemptResult {
  const context = load(repo, feature);
  findTask(context, id);
  const rec = record(context, id);
  rec.attempts ??= {};
  const attempts = (rec.attempts[options.failure] ??= { symptom: options.symptom ?? "(증상 없음)", rounds: [] });
  if (options.symptom && attempts.rounds.length === 0) attempts.symptom = options.symptom;

  if (attempts.rounds.length >= MAX_ROUNDS) {
    rec.status = "handed";
    if (!context.checkpoint.handed.includes(id)) context.checkpoint.handed.push(id);
    delete context.checkpoint.current;
    recordFailure(repo, context, id, options.failure, "handed", options.today);
    save(repo, context);
    throw new Refusal(
      `${id}의 ${CHECK_TEXT[options.failure]} 실패에 대한 시도가 ${MAX_ROUNDS}회를 넘었다. 원인을 잘못 짚었다는 신호이므로 사람에게 넘긴다. 남은 실패는 failures.md에 적었다. 멈추고 보고한다.`,
    );
  }
  attempts.rounds.push({ note: options.note });
  context.checkpoint.current = { task: id, phase: "heal" };
  save(repo, context);
  return { task: id, failure: options.failure, round: attempts.rounds.length, remaining: MAX_ROUNDS - attempts.rounds.length };
}

// ---------------------------------------------------------------------------
// final

export interface FinalOptions {
  today: string;
  result: "pass" | "fail";
  /** 통과일 때 마지막 확인이 돌린 검사의 결과. 빠진 검사가 있으면 거부한다. */
  checks?: Partial<Record<Check, CheckResult>>;
  files?: string[];
  failure?: Check;
  symptom?: string;
}

/** spec에서 Figma 줄(`**Figma**:`)이 있는 스토리의 ID. */
export function figmaStories(spec: string): Set<string> {
  const stories = new Set<string>();
  let current: string | undefined;
  for (const line of spec.split("\n")) {
    const heading = /^#{2,4}\s+(US\d+)\b/.exec(line);
    if (heading) current = heading[1];
    else if (/^\*\*Figma\*\*\s*:/.test(line.trim()) && current) stories.add(current);
  }
  return stories;
}

/** 마지막 확인에서 캡처의 대조가 필요한가: Figma 노드가 있는 `ui` 작업이 하나라도 있을 때. */
function designRequired(repo: Repo, context: Context): boolean {
  const stories = figmaStories(loadDoc(repo, "spec", context.feature)?.body ?? "");
  const body = loadDoc(repo, "breakdown", context.feature)?.body.split("\n") ?? [];
  return liveTasks(context.tasks).some(
    (task) => context.checkpoint.assignments[task.id] === "ui" && ((task.story !== undefined && stories.has(task.story)) || /figma\.com\//.test(body[task.line - 1] ?? "")),
  );
}

/** 마지막 확인이 돌려야 하는 검사. 빌드와 테스트는 통과여야 하고 나머지는 건너뜀도 된다. */
function finalChecks(repo: Repo, context: Context): Check[] {
  return ["build", "lint", "test", "principles", ...(designRequired(repo, context) ? (["design"] as Check[]) : [])];
}

export interface FinalResult {
  result: "pass" | "fail";
  /** 마지막 확인 줄을 올리고 체크포인트를 지웠다. */
  done: boolean;
  lowered: string[];
  unmatched: string[];
  /** 지우기 전의 체크포인트. 완료 보고에 옮긴다. */
  checkpoint?: Checkpoint;
}

/** 마지막 확인의 결과. 통과면 마지막 확인 줄을 올리고 체크포인트를 지운다. 실패면 대응 작업의 체크를 내리고 고치지 않는다. */
export function implFinal(repo: Repo, feature: string, options: FinalOptions): FinalResult {
  const context = load(repo, feature);
  if (options.result === "pass") {
    const open = liveTasks(context.tasks).filter((task) => !task.checked).map((task) => task.id);
    if (open.length > 0) throw new Refusal(`체크되지 않은 작업이 있어 마지막 확인을 올릴 수 없다: ${open.join(", ")}`);
    const checks = options.checks ?? {};
    const failed = (Object.entries(checks) as [Check, CheckResult][]).filter(([, value]) => value === "fail").map(([kind]) => CHECK_TEXT[kind]);
    if (failed.length > 0) throw new Refusal(`실패한 검사가 있다: ${failed.join(", ")}. 통과로 올릴 수 없고 --result fail --failure로 적는다.`);
    const missing = finalChecks(repo, context).filter((kind) => !satisfied(kind, checks[kind]));
    if (missing.length > 0) {
      const hint = missing.includes("design") ? " 디자인은 verify-ui의 캡처의 대조다(Figma 노드가 있는 ui 작업이 있다)." : "";
      throw new Refusal(`마지막 확인에 빠진 검사: ${missing.map((kind) => CHECK_TEXT[kind]).join(", ")}. 돌린 결과를 --check {검사}=pass|skip으로 모두 적는다. 빌드와 테스트는 건너뜀으로 올릴 수 없다.${hint}`);
    }
    writeChecks(repo, context, [FINAL_ID], true);
    const checkpoint = context.checkpoint;
    removeCheckpoint(repo, feature);
    return { result: "pass", done: true, lowered: [], unmatched: [], checkpoint };
  }

  if (!options.failure || !options.symptom) throw new Refusal("마지막 확인의 실패에는 --failure와 --symptom이 필요하다");
  const { matched, unmatched } = matchFiles(context, options.files ?? []);
  const lowered = lower(repo, context, [...matched.keys()]);
  if (matched.size === 0) recordFailure(repo, context, undefined, options.failure, "final", options.today, options.files ?? [], options.symptom);
  for (const [id, files] of matched) recordFailure(repo, context, id, options.failure, "final", options.today, files, options.symptom);
  delete context.checkpoint.current;
  save(repo, context);
  return { result: "fail", done: false, lowered, unmatched };
}

// ---------------------------------------------------------------------------
// reset, show

export interface ResetResult {
  task: string;
  cleared: Check[];
}

/** 사람이 승인한 뒤에만 부른다. 시도 횟수를 초기화하고 넘김을 푼다. */
export function implReset(repo: Repo, feature: string, id: string): ResetResult {
  const context = load(repo, feature);
  findTask(context, id);
  const rec = record(context, id);
  const cleared = Object.keys(rec.attempts ?? {}) as Check[];
  delete rec.attempts;
  if (rec.status === "handed") delete rec.status;
  context.checkpoint.handed = context.checkpoint.handed.filter((handed) => handed !== id);
  save(repo, context);
  return { task: id, cleared };
}

export interface ShowResult {
  feature: string;
  checkpoint: Checkpoint;
  units: { name: string; tasks: string[]; done: boolean; verified: boolean }[];
  progress: { done: number; total: number };
}

export function implShow(repo: Repo, feature: string): ShowResult {
  const context = load(repo, feature);
  const live = liveTasks(context.tasks);
  return {
    feature,
    checkpoint: context.checkpoint,
    units: context.units.map((unit) => ({
      name: unit.name,
      tasks: unit.tasks.map((task) => task.id),
      done: unit.tasks.every((task) => task.checked),
      verified: context.checkpoint.units[unit.name]?.checks !== undefined,
    })),
    progress: { done: live.filter((task) => task.checked).length, total: live.length },
  };
}

// ---------------------------------------------------------------------------
// 사람이 읽는 출력

export function formatStart(result: StartResult): string {
  const lines = [`${result.feature}: ${result.resumed ? "이어서 실행한다" : "시작한다"} (결정 ${result.checkpoint.started.decision === "pass" ? "통과" : "확인 뒤 계속"})`];
  lines.push(`문서 버전: ${Object.entries(result.versions).map(([kind, version]) => `${kind} ${version}`).join(", ")}`);
  for (const reason of result.reasons) lines.push(`- ${describeReason(reason)}`);
  return lines.join("\n");
}

export function formatAssign(result: AssignResult): string {
  const lines = ["배정표:"];
  for (const [id, kind] of Object.entries(result.assignments)) lines.push(`- ${id}: ${kind}${result.added.includes(id) ? " (새로 배정)" : ""}`);
  return lines.join("\n");
}

export function formatNext(result: NextResult): string {
  const lines: string[] = [];
  if (result.pendingUnit) lines.push(`단위 검증이 남았다: ${result.pendingUnit}. 다음 작업보다 먼저 검증하고 impl verify --unit으로 기록한다.`);
  if (result.done) lines.push("마지막 확인 줄이 체크되어 있다. 구현이 끝났다.");
  else if (result.final) lines.push("모든 작업이 체크됐다. 마지막 확인 차례다.");
  else if (result.task) {
    const task = result.task;
    lines.push(`다음 작업: ${task.id}${task.kind ? ` (${task.kind})` : " (배정 없음)"}${task.story ? ` [${task.story}]` : ""} — ${task.phase} 단계부터`);
    lines.push(`경로: ${task.paths.join(", ")}`);
    if (task.until) lines.push(`연결: ${task.until}이 끝날 때까지 검증 대기`);
    if (task.handed) lines.push("사람에게 넘긴 작업이다. 다시 시도할지 묻고, 승인하면 impl reset으로 초기화한다.");
    if (result.testable.length > 0) lines.push(`이 작업이 끝나면 돌릴 테스트: ${result.testable.join(", ")}`);
    if (result.unit) lines.push(`단위: ${result.unit}${result.unitEnd ? " (이 작업이 단위의 마지막이다)" : ""}`);
  }
  if (result.unassigned.length > 0) lines.push(`배정이 없는 작업: ${result.unassigned.join(", ")}. impl assign으로 종류를 준다.`);
  if (result.waiting.length > 0) lines.push(`검증 대기: ${result.waiting.join(", ")}`);
  if (result.handed.length > 0) lines.push(`사람에게 넘긴 작업: ${result.handed.join(", ")}`);
  return lines.join("\n");
}

export function formatReport(result: ReportResult): string {
  if (result.status === "handed") return `${result.task}: 사람에게 넘겼다. failures.md에 적었다.`;
  if (result.status === "blocked") return `${result.task}: 막힘으로 적었다. 보고하고 멈춘다.`;
  if (result.waiting) return `${result.task}: 테스트 작업이라 검증 대기로 두었다. 다음 작업으로 간다.`;
  return `${result.task}: 완료 보고를 적었다. 검증할 것: ${result.required.map((kind) => CHECK_TEXT[kind]).join(", ")}`;
}

export function formatVerify(result: VerifyResult): string {
  const lines = [`${result.task ?? `단위 ${result.unit}`}: ${Object.entries(result.checks).map(([kind, value]) => `${CHECK_TEXT[kind as Check]} ${RESULT_TEXT[value as CheckResult]}`).join(", ")}`];
  if (result.raised.length > 0) lines.push(`체크를 올렸다: ${result.raised.join(", ")}`);
  if (result.lowered.length > 0) lines.push(`체크를 내렸다: ${result.lowered.join(", ")}`);
  if (result.redo.length > 0) {
    lines.push("다시 고칠 작업 (치유 전에 impl attempt로 시도를 센다):");
    for (const redo of result.redo) lines.push(`- ${redo.id}${redo.kind ? ` (${redo.kind})` : ""}: ${CHECK_TEXT[redo.failure]} 실패`);
  }
  if (result.unmatched.length > 0) lines.push(`어느 작업에도 대응하지 않는 파일: ${result.unmatched.join(", ")}. 작업 없는 실패라 사람에게 넘긴다.`);
  if (result.blockedBySkip.length > 0) {
    lines.push(`건너뜀으로는 체크를 올릴 수 없는 검사: ${result.blockedBySkip.map((kind) => CHECK_TEXT[kind]).join(", ")}. 환경 문제를 사용자에게 알리고 멈춘다. 고쳐진 뒤 다시 부르면 이 작업의 검증부터 이어 간다.`);
  }
  const notYet = result.missing.filter((kind) => !result.blockedBySkip.includes(kind));
  if (notYet.length > 0) lines.push(`아직 돌리지 않은 검사: ${notYet.map((kind) => CHECK_TEXT[kind]).join(", ")}`);
  if (result.healed.length > 0) lines.push(`두 번 이상 시도한 끝에 치유된 실패를 failures.md에 적었다: ${result.healed.map((kind) => CHECK_TEXT[kind]).join(", ")}`);
  return lines.join("\n");
}

export function formatAttempt(result: AttemptResult): string {
  return `${result.task} ${CHECK_TEXT[result.failure]} 실패: ${result.round}회째 시도 (남은 횟수 ${result.remaining})`;
}

export function formatFinal(result: FinalResult): string {
  if (result.done) return "마지막 확인을 통과했다. 마지막 확인 줄을 올리고 체크포인트를 지웠다.";
  const lines = ["마지막 확인에서 실패가 남았다. 고치지 않고 failures.md에 적었다."];
  if (result.lowered.length > 0) lines.push(`체크를 내렸다: ${result.lowered.join(", ")}. 다시 부르면 이 작업부터 이어 간다.`);
  if (result.unmatched.length > 0) lines.push(`어느 작업에도 대응하지 않는 파일: ${result.unmatched.join(", ")}. 직접 고치거나 breakdown을 개정해 작업을 더한다.`);
  return lines.join("\n");
}

export function formatShow(result: ShowResult): string {
  const { checkpoint } = result;
  const lines = [
    `${result.feature}: ${result.progress.done}/${result.progress.total} (결정 ${checkpoint.started.decision}, 버전 ${Object.entries(checkpoint.started.versions).map(([k, v]) => `${k} ${v}`).join(", ")})`,
  ];
  if (checkpoint.current) lines.push(`진행 중: ${checkpoint.current.task} (${checkpoint.current.phase})`);
  for (const unit of result.units) lines.push(`- ${unit.name}: ${unit.tasks.join(", ")}${unit.done ? " — 완료" : ""}${unit.verified ? ", 검증됨" : ""}`);
  for (const [id, rec] of Object.entries(checkpoint.tasks)) {
    const attempts = Object.entries(rec.attempts ?? {}).map(([kind, value]) => `${CHECK_TEXT[kind as Check]} ${value?.rounds.length ?? 0}회`);
    const checks = Object.entries(rec.checks ?? {}).map(([kind, value]) => `${CHECK_TEXT[kind as Check]} ${RESULT_TEXT[value as CheckResult]}`);
    lines.push(`  ${id}: ${checkpoint.assignments[id] ?? "배정 없음"}${rec.status ? `, ${rec.status}` : ""}${checks.length ? `, ${checks.join("/")}` : ""}${attempts.length ? `, 시도 ${attempts.join("/")}` : ""}`);
  }
  if (checkpoint.waiting.length > 0) lines.push(`검증 대기: ${checkpoint.waiting.join(", ")}`);
  if (checkpoint.handed.length > 0) lines.push(`사람에게 넘김: ${checkpoint.handed.join(", ")}`);
  return lines.join("\n");
}
