export interface Task {
  /** `T001` 같은 작업 ID이거나 마지막 확인 줄의 `FINAL`. */
  id: string;
  checked: boolean;
  parallel: boolean;
  story?: string;
  /** 연결 표기. 이 테스트 작업을 통과시키는 마지막 구현 작업의 ID. */
  until?: string;
  dropped: boolean;
  /** 작업이 지정한 경로. 작업 줄 끝에 이어 적은 백틱 안이다. */
  paths: string[];
  /** 1부터 세는 줄 번호. */
  line: number;
}

export const FINAL_ID = "FINAL";

const TASK_LINE = /^\s*- \[([ xX])\] (T\d{3}|FINAL)(?=\s|$)(.*)$/;
const MARKER = /^\s*\[([^\]]+)\]/;
const FENCE = /^\s*(```|~~~)/;

/** breakdown 본문에서 작업 줄을 읽는다. 표시의 순서는 `[P]`, `[US…]`, `[until:…]`, `[dropped]`다. */
export function parseTasks(body: string): Task[] {
  const tasks: Task[] = [];
  let fence: string | null = null;

  body.replace(/\r\n?/g, "\n").split("\n").forEach((text, index) => {
    const fenceMatch = FENCE.exec(text);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1] ?? null;
      else if (fence === fenceMatch[1]) fence = null;
      return;
    }
    if (fence !== null) return;

    const match = TASK_LINE.exec(text);
    if (!match) return;

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
    if (task.until === undefined) continue;
    const target = order.get(task.until);
    if (target === undefined) problems.push(`${task.line}행: ${task.id}의 연결 표기가 없는 작업을 가리킨다: ${task.until}`);
    else if (target <= (order.get(task.id) ?? 0)) {
      problems.push(`${task.line}행: ${task.id}는 연결된 구현 작업 ${task.until}보다 앞에 있어야 한다`);
    }
  }
  return problems;
}

/** 작업 목록의 완료 수. 폐기된 작업과 마지막 확인 줄은 세지 않는다. */
export function countTasks(tasks: Task[]): { done: number; total: number } {
  const live = tasks.filter((task) => task.id !== FINAL_ID && !task.dropped);
  return { done: live.filter((task) => task.checked).length, total: live.length };
}
