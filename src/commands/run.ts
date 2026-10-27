import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MANIFEST_FILE } from "../core/extension.js";
import { Refusal, type Repo } from "../core/repo.js";

export interface RunResult {
  status: number;
  stdout?: string;
  stderr?: string;
}

const EXTENSION_NAME = /^[a-z0-9][a-z0-9-]*$/;
const SCRIPT_NAME = /^[A-Za-z0-9_.-]+\.mjs$/;

/**
 * 확장의 스크립트를 실행한다(구현 설계 「0.4 구현의 진행」 「확장 스크립트의 실행」).
 * 코어 스킬의 `allowed-tools`는 `Bash(sh *)`뿐이라 `node`를 직접 부를 수 없고, 이 명령이 실행 스크립트가 찾은 node로 대신 돌린다.
 * 확장마다 명령을 더하는 것이 아니라 실행기 하나다. `scripts/` 아래의 `.mjs`만 실행하고 인자는 그대로 넘긴다.
 */
export function runScript(repo: Repo, extension: string | undefined, script: string | undefined, args: string[], options: { capture?: boolean } = {}): RunResult {
  if (!extension || !EXTENSION_NAME.test(extension)) throw new Refusal(`확장 이름이 필요하다: run <확장> <스크립트> [인자…] (받은 값: ${extension || "없음"})`);
  const dir = path.join(repo.root, ".mob-sdd", "extensions", extension);
  if (!fs.existsSync(path.join(dir, MANIFEST_FILE))) throw new Refusal(`설치된 확장이 아니다: ${extension}`);
  if (!script || !SCRIPT_NAME.test(script)) throw new Refusal(`scripts/ 아래의 .mjs 파일 이름이 필요하다 (받은 값: ${script ?? "없음"})`);
  const file = path.join(dir, "scripts", script);
  if (!fs.existsSync(file)) throw new Refusal(`스크립트가 없다: .mob-sdd/extensions/${extension}/scripts/${script}`);

  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: repo.root,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    env: { ...process.env, MOB_SDD_ROOT: repo.root },
  });
  if (result.error) throw new Refusal(`스크립트를 실행하지 못했다: ${result.error.message}`);
  return { status: result.status ?? 2, ...(options.capture ? { stdout: result.stdout, stderr: result.stderr } : {}) };
}
