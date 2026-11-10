import { detectProject, type Detected } from "../core/detect.js";
import {
  DEFAULT_COMMANDS,
  moduleCommands,
  NO_COMMAND,
  readPartialChecks,
  spoken,
  withModules,
  type CommandSpec,
  type SetupOptions,
} from "../core/impl-config.js";
import type { Repo } from "../core/repo.js";
import { confirm, type Ask } from "./init-prompt.js";

export interface SetupPromptOptions {
  ask: Ask;
  print: (text: string) => void;
}

/**
 * 검사 명령을 사람에게 묻는다. 터미널에서 인자 없이 부른 `impl setup`과 `init`이 쓴다.
 * Gradle 설정에서 찾은 것을 선택지로 보여 주고 사람이 고른 것만 돌려준다. 적는 것은 implSetup이다.
 * 찾은 것이 없는 질문은 묻지 않는다. 지금 설정이 있으면 그것이 Enter의 기본이라, 다시 불러도 바뀌지 않는다.
 */
export async function promptImplSetup(repo: Repo, prompt: SetupPromptOptions): Promise<SetupOptions> {
  const { ask, print } = prompt;
  const detected = detectProject(repo.root);
  const current = readPartialChecks(repo);
  const options: SetupOptions = {};

  print("구현 단계는 작업마다 이 명령들을 직접 돌려, 성공한 작업만 체크한다. 빌드와 테스트는 기본값이 있다.");
  const lint = await askLint(current.lint, detected, prompt);
  if (lint !== undefined) options.lint = lint;

  const rules = detected.rules[0]?.command;
  if (current.rules === undefined && rules) {
    print(`\n규칙 도구 ${spoken(detected.rules)}를 찾았다. constitution 원칙의 규칙을 작업마다 돌린다.`);
    if (await confirm(ask, `  ${rules}\n이 명령으로 돌릴까? (Y/n): `)) options.rules = rules;
  }

  // flavor나 Kotlin/JVM 모듈처럼 기본 명령이 돌지 않는 모듈. 사람이 보고 받아들이면 모듈 묶음으로 적는다.
  const base = { build: current.build ?? DEFAULT_COMMANDS.build, test: current.test ?? DEFAULT_COMMANDS.test };
  const { reasons, entries } = moduleCommands(base, detected);
  const kinds = (["build", "test"] as const).filter((kind) => entries[kind].length > 0);
  if (kinds.length > 0) {
    const proposed = Object.fromEntries(kinds.map((kind) => [kind, withModules(base[kind], entries[kind])])) as Record<"build" | "test", Record<string, string>>;
    print(
      [
        "",
        ...reasons.filter((reason) => reason.module).map((reason) => reason.text),
        "모듈마다 이렇게 적는다. flavor 차원이 여럿이면 적은 뒤 이름을 조합해 고친다.",
        ...kinds.flatMap((kind) => [`  ${kind}:`, ...Object.entries(proposed[kind]).map(([module, command]) => `    "${module}": "${command}"`)]),
      ].join("\n"),
    );
    if (await confirm(ask, "이대로 적을까? (Y/n): ")) for (const kind of kinds) options[kind] = proposed[kind];
  }
  return options;
}

/** Lint 명령을 고르게 한다. 지금 설정을 그대로 두면 undefined. */
async function askLint(current: CommandSpec | undefined, detected: Detected, { ask, print }: SetupPromptOptions): Promise<string | undefined> {
  const found = detected.lint.map((item) => item.command);
  // 지금 설정이 찾은 명령이나 none과 다르면 그대로 두는 선택지를 먼저 둔다.
  const keep = current !== undefined && current !== NO_COMMAND && !(typeof current === "string" && found.includes(current));
  const choices: { label: string; value: CommandSpec }[] = [
    ...(keep ? [{ label: `지금 설정을 둔다: ${typeof current === "string" ? current : JSON.stringify(current)}`, value: current }] : []),
    ...found.map((command) => ({ label: command === current ? `${command} (지금 설정)` : command, value: command })),
  ];
  const index = choices.findIndex((choice) => choice.value === current);
  const fallback = current === NO_COMMAND || choices.length === 0 ? "n" : String(index >= 0 ? index + 1 : 1);

  print(
    [
      "",
      detected.lint.length > 0
        ? `Lint 명령을 고른다. 프로젝트에서 ${spoken(detected.lint)}를 찾았다.`
        : "Lint 명령을 고른다. 프로젝트의 Gradle 설정에서 Lint 도구(detekt, ktlint, kotlinter, spotless)를 찾지 못했다.",
      ...choices.map((choice, i) => `  ${i + 1}) ${choice.label}`),
      `  n) Lint 없이 진행한다${current === NO_COMMAND ? " (지금 설정)" : ""}`,
      "  다른 명령은 그대로 입력한다",
    ].join("\n"),
  );
  for (;;) {
    const answer = (await ask(`선택 (Enter면 ${fallback}): `)).trim() || fallback;
    let chosen: CommandSpec;
    if (/^\d+$/.test(answer)) {
      const choice = choices[Number(answer) - 1];
      if (!choice) {
        print("없는 번호다.");
        continue;
      }
      chosen = choice.value;
    } else if (answer.toLowerCase() === "n" || answer === NO_COMMAND) {
      chosen = NO_COMMAND;
    } else if (/^[a-z]{1,3}$/i.test(answer)) {
      // y, q 같은 짧은 답을 명령으로 적지 않는다.
      print("번호나 n, 또는 ./gradlew {module}:detekt 같은 명령을 입력한다.");
      continue;
    } else {
      chosen = answer;
    }
    return chosen === current || typeof chosen !== "string" ? undefined : chosen;
  }
}
