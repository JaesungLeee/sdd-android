export interface Task {
  /** `T001` 같은 작업 ID이거나 마지막 확인 줄의 `FINAL`. */
  id: string;
  checked: boolean;
  parallel: boolean;
  story?: string;
  /** 수정 단위의 ID(`FIX-001`). 구현이 끝난 feature에 `/fix`가 더한 작업이다. 스토리 대신 단다. */
  fix?: string;
  /** 연결 표기. 이 테스트 작업을 통과시키는 마지막 구현 작업의 ID. */
  until?: string;
  dropped: boolean;
  /** 작업이 지정한 경로. 작업 줄 끝에 이어 적은 백틱 안이다. */
  paths: string[];
  /** 1부터 세는 줄 번호. */
  line: number;
}

export const FINAL_ID = "FINAL";

export const FIX_ID = /^FIX-\d{3}$/;

const TASK_LINE = /^\s*- \[([ xX])\] (T\d{3}|FINAL)(?=\s|$)(.*)$/;
const MARKER = /^\s*\[([^\]]+)\]/;
const FENCE = /^\s*(```|~~~)/;
const COMMENT_OPEN = /^\s*<!--/;

/**
 * 작업 줄을 찾는다. 코드 블록과 HTML 주석 안은 보지 않는다.
 * 템플릿의 주석에 든 예시(`- [ ] T007 [FIX-001] …`)가 지워지지 않고 남아도 작업이 되지 않게 하기 위해서다.
 */
function scanTaskLines(lines: string[], visit: (match: RegExpExecArray, index: number) => void): void {
  let fence: string | null = null;
  let comment = false;
  lines.forEach((text, index) => {
    if (comment) {
      if (text.includes("-->")) comment = false;
      return;
    }
    const fenceMatch = FENCE.exec(text);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1] ?? null;
      else if (fence === fenceMatch[1]) fence = null;
      return;
    }
    if (fence !== null) return;
    if (COMMENT_OPEN.test(text)) {
      comment = !text.slice(text.indexOf("<!--") + 4).includes("-->");
      return;
    }
    const match = TASK_LINE.exec(text);
    if (match) visit(match, index);
  });
}

/** breakdown 본문에서 작업 줄을 읽는다. 표시의 순서는 `[P]`, `[US…]`나 `[FIX-…]`, `[until:…]`, `[dropped]`다. */
export function parseTasks(body: string): Task[] {
  const tasks: Task[] = [];

  scanTaskLines(body.replace(/\r\n?/g, "\n").split("\n"), (match, index) => {
    const task: Task = {
      id: match[2] as string,
      checked: match[1] !== " ",
      parallel: false,
      dropped: false,
      paths: [],
      line: index + 1,
    };

    let rest = match[3] ?? "";
    for (;;) {
      const marker = MARKER.exec(rest);
      if (!marker) break;
      const value = marker[1] as string;
      if (value === "P") task.parallel = true;
      else if (/^US\d+$/.test(value)) task.story = value;
      else if (FIX_ID.test(value)) task.fix = value;
      else if (/^until:T\d{3}$/.test(value)) task.until = value.slice("until:".length);
      else if (value === "dropped") task.dropped = true;
      else break;
      rest = rest.slice(marker[0].length);
    }
    // 경로는 줄 끝에 이어 적은 백틱만이다. 설명 안의 백틱(명령, 출력 예시)은 경로가 아니다.
    const tail = /((?:`[^`]+`[\s,]*)+)$/.exec(rest);
    task.paths = tail ? [...(tail[1] as string).matchAll(/`([^`]+)`/g)].map((found) => found[1] as string) : [];
    tasks.push(task);
  });
  return tasks;
}

/** 작업 줄의 형식을 검사한다. 돌려주는 것은 문제의 설명이다. */
export function validateTasks(tasks: Task[]): string[] {
  const problems: string[] = [];
  const order = new Map<string, number>();
  tasks.forEach((task, index) => {
    if (order.has(task.id)) problems.push(`${task.line}행: 작업 ID가 중복됐다: ${task.id}`);
    else order.set(task.id, index);
  });

  const final = tasks.filter((task) => task.id === FINAL_ID);
  if (final.length === 0) problems.push("마지막 확인 줄(FINAL)이 없다");
  else if (tasks[tasks.length - 1]?.id !== FINAL_ID) problems.push("마지막 확인 줄(FINAL)이 마지막 작업 줄이 아니다");

  for (const task of tasks) {
    if (task.id === FINAL_ID) continue;
    if (task.paths.length === 0) problems.push(`${task.line}행: ${task.id}에 백틱으로 감싼 경로가 없다`);
    if (task.story && task.fix) problems.push(`${task.line}행: ${task.id}에 스토리와 수정 단위가 함께 있다. 하나만 단다`);
    if (task.until === undefined) continue;
    const target = order.get(task.until);
    if (target === undefined) problems.push(`${task.line}행: ${task.id}의 연결 표기가 없는 작업을 가리킨다: ${task.until}`);
    else if (target <= (order.get(task.id) ?? 0)) {
      problems.push(`${task.line}행: ${task.id}는 연결된 구현 작업 ${task.until}보다 앞에 있어야 한다`);
    }
  }
  problems.push(...scatteredUnits(tasks));
  return problems;
}

/**
 * 한 스토리나 수정 단위의 작업이 다른 스토리를 사이에 두고 떨어져 있는 곳. 단위는 이름으로 기록되므로
 * 떨어진 두 무리가 같은 이름의 단위 둘이 되어 검증 기록이 섞인다. 끝난 스토리에 작업을 더하려면 수정 단위를 쓴다.
 */
function scatteredUnits(tasks: Task[]): string[] {
  const problems: string[] = [];
  const closed = new Set<string>();
  let current: string | undefined;
  for (const task of liveTasks(tasks)) {
    const name = task.fix ?? task.story;
    if (!name || name === current) continue;
    if (current) closed.add(current);
    if (closed.has(name)) {
      problems.push(`${task.line}행: ${name}의 작업이 다른 단위 뒤에 다시 나온다. 한 단위의 작업은 한곳에 모은다. 끝난 기능에 작업을 더하려면 수정 단위([FIX-…])를 쓴다`);
      closed.delete(name);
    }
    current = name;
  }
  return problems;
}

/** 작업 목록의 완료 수. 폐기된 작업과 마지막 확인 줄은 세지 않는다. */
export function countTasks(tasks: Task[]): { done: number; total: number } {
  const live = liveTasks(tasks);
  return { done: live.filter((task) => task.checked).length, total: live.length };
}

/** 실행할 작업. 폐기된 작업과 마지막 확인 줄을 뺀 것이다. */
export function liveTasks(tasks: Task[]): Task[] {
  return tasks.filter((task) => task.id !== FINAL_ID && !task.dropped);
}

/**
 * 작업 줄의 체크를 올리거나 내린 본문. 그 밖의 글자는 그대로다.
 * 체크는 해시에 들어가지 않으므로(정규화의 uncheck) 이 변경은 미기록 변경이 아니다.
 */
export function setChecked(body: string, ids: readonly string[], checked: boolean): string {
  if (ids.length === 0) return body;
  const wanted = new Set(ids);
  const mark = checked ? "x" : " ";
  const lines = body.split("\n");
  scanTaskLines(lines, (match, index) => {
    if (wanted.has(match[2] as string)) lines[index] = (lines[index] as string).replace(/^(\s*- )\[[ xX]\]/, `$1[${mark}]`);
  });
  return lines.join("\n");
}

/** 멈춤 단위. 스토리마다 하나이고, 마지막 스토리 뒤의 작업은 `tail` 하나다. */
export interface Unit {
  name: string;
  tasks: Task[];
}

export const TAIL_UNIT = "tail";

/**
 * 작업을 멈춤 단위로 나눈다(구현 단계 스킬 구성 §2 「자동 진행」).
 * 각 스토리의 첫 작업 앞에서 나누므로, 스토리 밖의 작업은 다음 스토리의 단위에 들어간다.
 * 마지막 스토리 뒤에 남는 작업은 `tail`이다. 스토리가 하나도 없으면 전체가 `tail`이다.
 * 수정 단위의 작업은 스토리의 나눔과 따로 그 ID마다 한 단위다. 수정 단위를 더해도 기존 단위의 구성은 바뀌지 않는다.
 */
export function splitUnits(tasks: Task[]): Unit[] {
  const fixes: Unit[] = [];
  for (const task of liveTasks(tasks)) {
    if (!task.fix) continue;
    const unit = fixes.find((candidate) => candidate.name === task.fix);
    if (unit) unit.tasks.push(task);
    else fixes.push({ name: task.fix, tasks: [task] });
  }
  return [...splitStories(tasks), ...fixes];
}

function splitStories(tasks: Task[]): Unit[] {
  const live = liveTasks(tasks).filter((task) => !task.fix);
  const units: Unit[] = [];
  let pending: Task[] = [];
  let current: Unit | undefined;
  for (const task of live) {
    if (!task.story) {
      pending.push(task);
      continue;
    }
    if (task.story !== current?.name) {
      current = { name: task.story, tasks: pending };
      pending = [];
      units.push(current);
    }
    current.tasks.push(task);
  }
  if (pending.length > 0) units.push({ name: TAIL_UNIT, tasks: pending });
  return units;
}

/** 작업이 속한 단위의 이름. */
export function unitOf(units: Unit[], id: string): Unit | undefined {
  return units.find((unit) => unit.tasks.some((task) => task.id === id));
}

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/** 파일이 작업이 지정한 경로 안에 있는지. `/`로 끝나는 경로는 그 디렉터리 아래 전체다. */
export function pathCovers(taskPath: string, file: string): boolean {
  const target = normalizePath(file);
  if (taskPath.endsWith("/")) return target.startsWith(normalizePath(taskPath) + "/") || target === normalizePath(taskPath);
  return normalizePath(taskPath) === target;
}

/**
 * 파일에 대응하는 작업. 여러 작업의 경로에 걸치면 가장 긴 경로로 맞은 작업을 고르고, 그래도 여럿이면 모두 돌려준다.
 * 검증 보고의 파일로 다시 고칠 작업을 찾는 데 쓴다(구현 단계 스킬 구성 §2 「완료의 인정」).
 */
export function matchTasks(tasks: Task[], file: string): Task[] {
  let best = -1;
  let found: Task[] = [];
  for (const task of liveTasks(tasks)) {
    const longest = Math.max(-1, ...task.paths.filter((taskPath) => pathCovers(taskPath, file)).map((taskPath) => normalizePath(taskPath).length));
    if (longest < 0) continue;
    if (longest > best) {
      best = longest;
      found = [task];
    } else if (longest === best) found.push(task);
  }
  return found;
}
