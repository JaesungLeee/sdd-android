import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { Refusal, type Repo } from "./repo.js";

/** 구현 스킬의 종류. 0.3에서는 코어에 고정한다. 두 번째 스택이 생길 때 확장이 선언하는 구조로 바꾼다. */
export const KINDS = ["test", "logic", "ui", "structure"] as const;
export type Kind = (typeof KINDS)[number];

/** 검사의 종류. 실패의 종류와 같은 이름을 쓴다. */
export const CHECKS = ["build", "lint", "test", "design", "principles"] as const;
export type Check = (typeof CHECKS)[number];

export type CheckResult = "pass" | "fail" | "skip";
export type Phase = "create" | "verify" | "heal";

export interface Round {
  /** 이 회차에 짚은 원인과 시도. */
  note: string;
  /** 다음 검증이 채운다. 비어 있으면 아직 검증하지 않은 회차다. */
  result?: CheckResult;
}

export interface Attempts {
  symptom: string;
  rounds: Round[];
}

export interface TaskRecord {
  status?: "done" | "blocked" | "handed";
  modules?: string[];
  files?: string[];
  /** UI 작업이 만든 Compose 프리뷰 함수의 전체 이름. 캡처의 대조가 그대로 쓴다. */
  previews?: string[];
  checks?: Partial<Record<Check, CheckResult>>;
  attempts?: Partial<Record<Check, Attempts>>;
}

export interface UnitRecord {
  checks?: Partial<Record<Check, CheckResult>>;
}

/** 진행 중인 상태만 담는다. 완료 여부의 기준은 breakdown의 체크뿐이다(구현 단계 스킬 구성 §2). */
export interface Checkpoint {
  started: {
    decision: "pass" | "acknowledged";
    /** 착수 게이트를 확인한 때의 문서 버전. */
    versions: Record<string, string>;
  };
  assignments: Record<string, Kind>;
  current?: { task: string; phase: Phase };
  tasks: Record<string, TaskRecord>;
  units: Record<string, UnitRecord>;
  /** 검증 대기인 테스트 작업. */
  waiting: string[];
  /** 사람에게 넘긴 작업. */
  handed: string[];
}

export const MAX_ROUNDS = 3;

const IMPL_DIR = "impl";

export function implDir(repo: Repo, feature?: string): string {
  const dir = path.join(repo.root, ".sdd-first", IMPL_DIR);
  return feature ? path.join(dir, feature) : dir;
}

export function checkpointPath(repo: Repo, feature: string): string {
  return path.join(implDir(repo, feature), "checkpoint.yaml");
}

export function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

export function isCheck(value: string): value is Check {
  return (CHECKS as readonly string[]).includes(value);
}

export function isCheckResult(value: string): value is CheckResult {
  return value === "pass" || value === "fail" || value === "skip";
}

export function emptyCheckpoint(decision: Checkpoint["started"]["decision"], versions: Record<string, string>): Checkpoint {
  return { started: { decision, versions }, assignments: {}, tasks: {}, units: {}, waiting: [], handed: [] };
}

export function readCheckpoint(repo: Repo, feature: string): Checkpoint | undefined {
  const file = checkpointPath(repo, feature);
  if (!fs.existsSync(file)) return undefined;
  let data: unknown;
  try {
    data = parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Refusal(`체크포인트를 읽을 수 없다: ${file}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  if (!data || typeof data !== "object") throw new Refusal(`체크포인트가 비어 있다: ${file}`);
  const raw = data as Partial<Checkpoint>;
  if (!raw.started?.versions) throw new Refusal(`체크포인트에 착수 기록이 없다: ${file}`);
  return {
    started: raw.started,
    assignments: raw.assignments ?? {},
    ...(raw.current ? { current: raw.current } : {}),
    tasks: raw.tasks ?? {},
    units: raw.units ?? {},
    waiting: raw.waiting ?? [],
    handed: raw.handed ?? [],
  };
}

/** 체크포인트는 커밋하지 않는다. 사용자의 `.gitignore`는 고치지 않고 디렉터리 안에 ignore 파일을 둔다(PRD SYS-006). */
export function writeCheckpoint(repo: Repo, feature: string, checkpoint: Checkpoint): void {
  const dir = implDir(repo);
  fs.mkdirSync(implDir(repo, feature), { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
  fs.writeFileSync(checkpointPath(repo, feature), stringify(checkpoint));
}

export function removeCheckpoint(repo: Repo, feature: string): void {
  fs.rmSync(implDir(repo, feature), { recursive: true, force: true });
}
