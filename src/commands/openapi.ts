import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { validateSources, type SourceConfig } from "../extensions/openapi/config.js";
import { Refusal, type Repo } from "../core/repo.js";

/**
 * OpenAPI 출처의 설정(PRD CLI-004). `.mob-sdd/config.yaml`의 `openapi.sources`를 손으로 고치지 않게 하는 명령이다.
 * 설정 파일의 다른 내용과 주석은 그대로 둔다. 팀이 공유하는 설정이라 커밋된다.
 */

function configFile(repo: Repo): string {
  return path.join(repo.root, ".mob-sdd", "config.yaml");
}

/** 지금 설정의 출처. 형식이 어긋나면 그 이유와 함께 거부한다. 고치기 전에 사람이 봐야 한다. */
export function listSources(repo: Repo): SourceConfig[] {
  const doc = parseDocument(fs.readFileSync(configFile(repo), "utf8"));
  const raw = doc.getIn(["openapi"], false);
  const plain = raw && typeof raw === "object" && "toJSON" in raw ? (raw as { toJSON(): unknown }).toJSON() : raw;
  try {
    return validateSources(plain);
  } catch (error) {
    throw new Refusal(`설정의 openapi가 형식에 맞지 않는다: ${error instanceof Error ? error.message : String(error)}. 파일을 고친 뒤 다시 한다`);
  }
}

function writeSources(repo: Repo, sources: SourceConfig[]): void {
  const file = configFile(repo);
  const doc = parseDocument(fs.readFileSync(file, "utf8"));
  if (sources.length === 0) doc.deleteIn(["openapi"]);
  else doc.setIn(["openapi", "sources"], sources);
  fs.writeFileSync(file, doc.toString());
}

export interface AddSourceOptions {
  url?: string;
  path?: string;
}

export interface AddSourceResult {
  source: SourceConfig;
  /** 같은 이름이 있어 바꿨다. */
  replaced: boolean;
  sources: SourceConfig[];
}

/** 출처를 더한다. 같은 이름이 있으면 바꾼다. `path`의 파일은 있어야 한다(`check`가 같은 것을 본다). */
export function addSource(repo: Repo, name: string | undefined, options: AddSourceOptions): AddSourceResult {
  if (!name) throw new Refusal("출처 이름이 필요하다: openapi add <이름> --url <주소> | --path <경로>");
  const hasUrl = options.url !== undefined && options.url !== "";
  const hasPath = options.path !== undefined && options.path !== "";
  if (hasUrl === hasPath) throw new Refusal("--url과 --path 가운데 하나만 준다");
  const source: SourceConfig = hasUrl ? { name, url: options.url as string } : { name, path: (options.path as string).replace(/\\/g, "/") };
  if (source.path && !fs.existsSync(path.join(repo.root, source.path))) throw new Refusal(`파일이 없다: ${source.path} (저장소 루트 기준)`);

  const current = listSources(repo);
  const replaced = current.some((item) => item.name === name);
  const next = [...current.filter((item) => item.name !== name), source];
  try {
    validateSources({ sources: next });
  } catch (error) {
    throw new Refusal(error instanceof Error ? error.message : String(error));
  }
  writeSources(repo, next);
  return { source, replaced, sources: next };
}

export function removeSource(repo: Repo, name: string | undefined): { removed: SourceConfig; sources: SourceConfig[] } {
  if (!name) throw new Refusal("출처 이름이 필요하다: openapi remove <이름>");
  const current = listSources(repo);
  const removed = current.find((item) => item.name === name);
  if (!removed) throw new Refusal(`그런 출처가 없다: ${name} (있는 것: ${current.map((item) => item.name).join(", ") || "없음"})`);
  const next = current.filter((item) => item.name !== name);
  writeSources(repo, next);
  return { removed, sources: next };
}

export function formatSources(sources: SourceConfig[]): string {
  if (sources.length === 0) return "OpenAPI 출처가 없다. openapi add <이름> --url <주소> | --path <경로>로 더한다.";
  return sources.map((source) => `- ${source.name}: ${source.url ?? source.path}${source.path ? " (파일)" : ""}`).join("\n");
}
