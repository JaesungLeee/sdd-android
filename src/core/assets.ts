import fs from "node:fs";
import path from "node:path";

/** 묶음의 상대 경로에서 내용으로. 경로는 `/`로 나눈다. */
export type FileMap = Map<string, string>;

/**
 * 패키지에 실린 스킬과 템플릿.
 * 번들 안에 들어 있어 npm 패키지가 파일 하나로 끝난다(PRD CLI-001).
 * 키는 `ko/skills/prd/SKILL.md`, `ko/templates/prd.md` 꼴이다.
 */
export interface Assets {
  languages(): string[];
  /** 언어의 스킬과 템플릿. `skills/prd/SKILL.md`, `templates/prd.md`에서 내용으로. */
  core(language: string): FileMap;
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
