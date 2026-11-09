import fs from "node:fs";
import path from "node:path";

/** 묶음의 상대 경로에서 내용으로. 경로는 `/`로 나눈다. */
export type FileMap = Map<string, string>;

/**
 * 패키지에 실린 스킬, 템플릿, 내장 확장.
 * 번들 안에 들어 있어 저장소의 번들이 자기 버전의 원본을 언제나 갖는다(PRD CLI-004).
 * 키는 `ko/skills/prd/SKILL.md`, `ko/templates/prd.md`, `ko/extensions/android/extension.yaml` 꼴이다.
 */
export interface Assets {
  languages(): string[];
  /** 언어의 코어 파일. `skills/prd/SKILL.md`, `templates/prd.md`에서 내용으로. */
  core(language: string): FileMap;
  /** 언어의 내장 확장. 이름에서 묶음 파일로. */
  extensions(language: string): Map<string, FileMap>;
}

declare const __ASSETS__: Record<string, string> | undefined;

export function assetsFromMap(files: Record<string, string>): Assets {
  const byLanguage = new Map<string, FileMap>();
  for (const [key, text] of Object.entries(files)) {
    const slash = key.indexOf("/");
    if (slash < 0) continue;
    const language = key.slice(0, slash);
    const rel = key.slice(slash + 1);
    if (!byLanguage.has(language)) byLanguage.set(language, new Map());
    byLanguage.get(language)?.set(rel, text);
  }
  return {
    languages: () => [...byLanguage.keys()].sort(),
    core: (language) => {
      const result: FileMap = new Map();
      for (const [rel, text] of byLanguage.get(language) ?? []) {
        if (rel.startsWith("skills/") || rel.startsWith("templates/")) result.set(rel, text);
      }
      return result;
    },
    extensions: (language) => {
      const result = new Map<string, FileMap>();
      for (const [rel, text] of byLanguage.get(language) ?? []) {
        const match = /^extensions\/([^/]+)\/(.+)$/.exec(rel);
        if (!match) continue;
        const [, name, inner] = match as unknown as [string, string, string];
        if (!result.has(name)) result.set(name, new Map());
        result.get(name)?.set(inner, text);
      }
      return result;
    },
  };
}

function walk(dir: string, prefix = ""): Record<string, string> {
  const files: Record<string, string> = {};
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, walk(path.join(dir, entry.name), rel));
    else if (entry.isFile()) files[rel] = fs.readFileSync(path.join(dir, entry.name), "utf8");
  }
  return files;
}

/** 빌드가 낸 `dist/assets` 모양의 디렉터리를 읽는다. 번들이 아닌 실행(개발, 테스트)에서 쓴다. */
export function assetsFromDir(dir: string): Assets {
  return assetsFromMap(walk(dir));
}

/** 번들에 실린 것을 쓰고, 번들이 아니면 자기 옆의 `assets/`를 읽는다. */
export function loadAssets(selfPath: string): Assets {
  if (typeof __ASSETS__ !== "undefined" && __ASSETS__) return assetsFromMap(__ASSETS__);
  return assetsFromDir(path.join(path.dirname(selfPath), "assets"));
}

/** 묶음 디렉터리를 파일 묶음으로 읽는다. 로컬 경로의 확장에 쓴다. */
export function bundleFromDir(dir: string): FileMap {
  return new Map(Object.entries(walk(dir)));
}
