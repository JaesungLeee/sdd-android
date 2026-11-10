import { describeConflicts, hasConflicts, planInit, type InitOptions } from "./init.js";

/** 질문을 보여 주고 한 줄을 받는다. 테스트에서는 미리 정한 답을 준다. */
export type Ask = (question: string) => Promise<string>;

export interface PromptOptions {
  /** 인자로 접두사를 받았다. 받았으면 묻지 않는다. */
  prefixGiven: boolean;
  ask: Ask;
  print: (text: string) => void;
}

/**
 * 설치 전에 사람에게 묻는다(PRD CLI-001). 돌려주는 것은 채워진 설치 옵션이고, 그만두면 `undefined`다.
 * 선택지가 하나뿐인 것(0.1의 언어와 에이전트)은 묻지 않는다. 인자로 준 값도 묻지 않는다.
 */
export async function promptInit(base: InitOptions, prompt: PromptOptions): Promise<InitOptions | undefined> {
  const { ask, print } = prompt;
  const options: InitOptions = { ...base };
  // 설치할 수 없는 곳이면 묻기 전에 멈춘다.
  planInit(options);

  print(`sdd-android ${options.version}을 ${options.target} 에 설치한다.`);
  if (!prompt.prefixGiven) options.prefix = await askPrefix(options, ask, print, "스킬 이름 접두사 (없으면 Enter): ");

  for (;;) {
    const { conflicts } = planInit({ ...options, backup: false });
    if (conflicts.state.length > 0 || !hasConflicts(conflicts)) break;

    print(["이미 있는 스킬과 이름이 겹친다.", ...describeConflicts(conflicts)].join("\n"));
    // 사용자 홈의 스킬은 건드리지 않으므로, 홈과 겹치면 덮어쓰기를 고를 수 없다.
    const canBackup = conflicts.home.length === 0;
    const choices = ["1) 접두사를 붙여 설치한다", ...(canBackup ? ["2) 기존 스킬을 백업으로 옮기고 설치한다"] : []), "q) 그만둔다"];
    const answer = (await ask(`${choices.join("\n")}\n선택: `)).trim().toLowerCase();
    if (answer === "1") {
      options.prefix = await askPrefix(options, ask, print, "접두사: ");
    } else if (answer === "2" && canBackup) {
      options.backup = true;
      break;
    } else if (answer === "q" || answer === "") {
      return undefined;
    }
  }

  const plan = planInit(options);
  const skills = plan.skills.map((name) => `/${name}`).join(", ");
  print(`설치할 파일 ${plan.files.size + 2}개. 스킬: ${skills}`);
  if (options.backup) print(`백업으로 옮길 스킬: ${plan.conflicts.skills.join(", ")} (.sdd-android/backup/ 아래)`);
  return (await confirm(ask, "진행할까? (Y/n): ")) ? options : undefined;
}

/** 예, 아니요를 묻는다. Enter는 예다. */
export async function confirm(ask: Ask, question: string): Promise<boolean> {
  const answer = (await ask(question)).trim().toLowerCase();
  return answer === "" || answer === "y" || answer === "yes";
}

async function askPrefix(options: InitOptions, ask: Ask, print: (text: string) => void, question: string): Promise<string> {
  for (;;) {
    const prefix = (await ask(question)).trim();
    try {
      planInit({ ...options, prefix });
      return prefix;
    } catch (error) {
      print(error instanceof Error ? error.message : String(error));
    }
  }
}
