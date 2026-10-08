/**
 * OpenAPI 대조 extension의 설정(`.mob-sdd/config.yaml`의 `openapi.sources`).
 * 스크립트와 `check`가 함께 쓴다. 스크립트 본체(`openapi.ts`)는 직접 실행 판정이 있어 CLI 번들에 넣지 않으므로, 공유하는 것은 여기에 둔다.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export interface SourceConfig {
  name: string;
  url?: string;
  path?: string;
}

const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** `.mob-sdd/config.yaml`의 `openapi.sources`. 형식이 어긋나면 던진다. */
export function readSources(root: string): SourceConfig[] {
  const file = path.join(root, ".mob-sdd", "config.yaml");
  if (!fs.existsSync(file)) throw new Error(`설정 파일이 없다: ${file}`);
  const data = (parse(fs.readFileSync(file, "utf8")) ?? {}) as { openapi?: unknown };
  return validateSources(data.openapi);
}

export function validateSources(raw: unknown): SourceConfig[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("openapi는 키와 값의 묶음이어야 한다");
  const sources = (raw as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) throw new Error("openapi.sources는 목록이어야 한다");
  const result: SourceConfig[] = [];
  const seen = new Set<string>();
  sources.forEach((item, index) => {
    const where = `openapi.sources[${index}]`;
    if (!item || typeof item !== "object") throw new Error(`${where}: name과 url이나 path가 있어야 한다`);
    const { name, url, path: file } = item as SourceConfig;
    if (typeof name !== "string" || !NAME.test(name)) throw new Error(`${where}: name은 소문자, 숫자, 하이픈이다`);
    if (seen.has(name)) throw new Error(`${where}: 이름이 겹친다: ${name}`);
    seen.add(name);
    const hasUrl = typeof url === "string" && url !== "";
    const hasPath = typeof file === "string" && file !== "";
    if (hasUrl === hasPath) throw new Error(`${where}: url과 path 가운데 하나만 적는다`);
    if (hasUrl && !/^https?:\/\//.test(url)) throw new Error(`${where}: url은 http(s)로 시작한다`);
    result.push(hasUrl ? { name, url } : { name, path: file });
  });
  return result;
}

