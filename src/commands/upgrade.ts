import fs from "node:fs";
import path from "node:path";
import type { Assets } from "../core/assets.js";
import { LAUNCHER_PATH, markExecutable } from "../core/launcher.js";
import { hashContent, readManifest, writeManifest, type Manifest } from "../core/manifest.js";
import { openRepo, Refusal } from "../core/repo.js";
import { compareVersions, isVersion } from "../core/version.js";
import { coreFiles } from "./init.js";

export interface UpgradeOptions {
  target: string;
  assets: Assets;
  bundlePath: string;
  /** 새 버전. */
  version: string;
  /** 패키지의 `CHANGELOG.md` 내용. */
  changelog?: string;
}

export interface UpgradeResult {
  from: string;
  to: string;
  /** 새 버전으로 바꾼 파일. */
  replaced: string[];
  /** 새로 생긴 파일. */
  added: string[];
  /** 없어져서 다시 만든 파일. */
  restored: string[];
  /** 사용자가 고쳐서 그대로 둔 파일과 옆에 둔 새 버전. */
  kept: { file: string; next: string }[];
  /** 새 버전에서 빠져 지운 파일. */
  removed: string[];
  /** 새 버전에서 빠졌지만 사용자가 고쳐서 남긴 파일. */
  orphaned: string[];
  changes: string;
}

/** `CHANGELOG.md`에서 `from`보다 뒤이고 `to`까지인 버전의 항목을 뽑는다. 제목은 `## [0.2.0] - 2026-10-07`이나 `## 0.2.0` 형태다. */
export function changelogBetween(changelog: string, from: string, to: string): string {
  const sections: string[] = [];
  let current: { version: string; lines: string[] } | undefined;
  const flush = () => {
    if (!current || !isVersion(current.version)) return;
    if (isVersion(from) && compareVersions(current.version, from) <= 0) return;
    if (isVersion(to) && compareVersions(current.version, to) > 0) return;
    sections.push(current.lines.join("\n").trimEnd());
  };
  for (const line of changelog.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^## \[?(\d+\.\d+\.\d+)\]?/.exec(line);
    if (heading) {
      flush();
      current = { version: heading[1] as string, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return sections.join("\n\n");
}

/**
 * 설치된 파일을 새 버전으로 올린다(PRD CLI-002).
 * 사용자가 고치지 않은 파일은 바꾸고, 고친 파일은 그대로 둔 채 새 버전을 `.new`로 옆에 둔다.
 * 사용자 산출물(`docs/` 아래)과 설정은 건드리지 않는다.
 */
export function upgrade(options: UpgradeOptions): UpgradeResult {
  const { target } = options;
  const manifest = readManifest(target);
  if (!manifest) throw new Refusal("설치 기록이 없다. 먼저 init으로 설치한다.");
  if (isVersion(manifest.version) && isVersion(options.version) && compareVersions(options.version, manifest.version) < 0) {
    throw new Refusal(`설치된 버전(${manifest.version})이 실행한 버전(${options.version})보다 높다. 낮은 버전으로 내리지 않는다.`);
  }

  const { config } = openRepo(target);
  const { files } = coreFiles({
    assets: options.assets,
    bundlePath: options.bundlePath,
    language: config.language,
    prefix: config.prefix,
  });

  const result: UpgradeResult = {
    from: manifest.version,
    to: options.version,
    replaced: [],
    added: [],
    restored: [],
    kept: [],
    removed: [],
    orphaned: [],
    changes: options.changelog ? changelogBetween(options.changelog, manifest.version, options.version) : "",
  };
  const next: Manifest = { version: options.version, files: {} };
  const write = (rel: string, content: string | Buffer) => {
    const file = path.join(target, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  // 0.4 전에 설치한 저장소의 실행 스크립트는 실행 비트가 없다. 바뀌지 않았어도 준다.
  if (fs.existsSync(path.join(target, LAUNCHER_PATH))) markExecutable(path.join(target, LAUNCHER_PATH));
  const currentHash = (rel: string) => {
    const file = path.join(target, rel);
    return fs.existsSync(file) ? hashContent(fs.readFileSync(file)) : undefined;
  };

  for (const [rel, content] of files) {
    const recorded = manifest.files[rel];
    const incoming = hashContent(content);
    const current = currentHash(rel);
    next.files[rel] = { sha256: incoming };

    if (current === undefined) {
      write(rel, content);
      (recorded ? result.restored : result.added).push(rel);
    } else if (current === incoming) {
      // 이미 새 버전과 같다. 기록만 맞춘다.
    } else if (recorded && current === recorded.sha256) {
      write(rel, content);
      result.replaced.push(rel);
    } else if (recorded && recorded.sha256 === incoming) {
      // 사용자가 고쳤고 새 버전에서는 바뀌지 않았다. 둘 것이 없다.
    } else {
      write(`${rel}.new`, content);
      result.kept.push({ file: rel, next: `${rel}.new` });
    }
  }

  for (const [rel, recorded] of Object.entries(manifest.files)) {
    if (files.has(rel)) continue;
    const current = currentHash(rel);
    if (current === undefined) continue;
    if (current === recorded.sha256) {
      fs.rmSync(path.join(target, rel));
      const dir = path.dirname(path.join(target, rel));
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      result.removed.push(rel);
    } else {
      result.orphaned.push(rel);
    }
  }

  writeManifest(target, next);
  return result;
}

export function formatUpgrade(result: UpgradeResult): string {
  const lines: string[] = [];
  lines.push(result.from === result.to ? `sdd-android ${result.to}: 설치된 파일을 점검했다.` : `sdd-android ${result.from} → ${result.to}`);
  if (result.changes) lines.push("", result.changes, "");
  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(title, ...items.map((item) => `- ${item}`));
  };
  section("바꾼 파일:", result.replaced);
  section("새 파일:", result.added);
  section("다시 만든 파일(없어져 있었다):", result.restored);
  section("지운 파일(새 버전에 없다):", result.removed);
  section("고친 파일이라 그대로 뒀다. 새 버전을 옆에 뒀으니 직접 합친 뒤 .new를 지운다:", result.kept.map((kept) => `${kept.file} (새 버전: ${kept.next})`));
  section("새 버전에 없지만 고친 파일이라 남겼다:", result.orphaned);
  if (lines.length === 1) lines.push("바뀐 파일이 없다.");
  return lines.join("\n");
}
