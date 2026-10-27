import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { validateSources, type SourceConfig } from "../extensions/openapi/config.js";
import { ACCEPT, discoverDocument, isHtml, type Fetch } from "../extensions/openapi/spec.js";
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

/**
 * 출처 하나를 넣거나(같은 이름이면 바꾸거나) 뺀다. 목록을 통째로 다시 쓰지 않고 그 항목만 고친다.
 * 목록 안의 주석과 다른 항목에 붙은 주석이 남는다.
 */
function writeSource(repo: Repo, change: { put: SourceConfig } | { remove: string }, current: SourceConfig[]): void {
  const file = configFile(repo);
  const doc = parseDocument(fs.readFileSync(file, "utf8"));
  const name = "put" in change ? change.put.name : change.remove;
  const index = current.findIndex((item) => item.name === name);
  if ("remove" in change) {
    if (current.length === 1) doc.deleteIn(["openapi"]);
    else doc.deleteIn(["openapi", "sources", index]);
  } else if (index < 0) {
    if (current.length === 0) doc.setIn(["openapi", "sources"], [change.put]);
    else doc.addIn(["openapi", "sources"], change.put);
  } else {
    const at = ["openapi", "sources", index];
    const [keep, drop] = change.put.url !== undefined ? (["url", "path"] as const) : (["path", "url"] as const);
    doc.setIn([...at, keep], change.put[keep]);
    doc.deleteIn([...at, drop]);
  }
  fs.writeFileSync(file, doc.toString());
}

export interface AddSourceOptions {
  url?: string;
  path?: string;
  /** 시험용. 없으면 전역 fetch다. */
  fetchImpl?: Fetch;
}

export interface AddSourceResult {
  source: SourceConfig;
  /** 같은 이름이 있어 바꿨다. */
  replaced: boolean;
  /** 받은 주소가 Swagger UI 페이지라 문서 주소로 바꿨다. */
  resolvedFrom?: string;
  /** 주소를 확인하지 못한 이유. 그대로 저장했다. */
  note?: string;
  sources: SourceConfig[];
}

/**
 * 주소가 Swagger UI 페이지면 그 페이지가 읽는 문서의 주소로 바꾼다. 설정에는 문서의 주소가 남아야 조회 시점의 출처가 분명하다.
 * 네트워크가 없거나 찾지 못하면 받은 대로 두고 알린다. 스크립트가 실행할 때 한 번 더 찾는다.
 */
async function resolveUrl(url: string, fetchImpl: Fetch): Promise<{ url: string; resolvedFrom?: string; note?: string }> {
  let text: string;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000), headers: ACCEPT });
    if (!response.ok) return { url, note: `주소를 확인하지 못했다(HTTP ${response.status}). 그대로 저장했다` };
    text = await response.text();
  } catch (error) {
    return { url, note: `주소를 확인하지 못했다(${error instanceof Error ? error.message : String(error)}). 그대로 저장했다` };
  }
  if (!isHtml(text)) return { url };
  const found = await discoverDocument(url, fetchImpl);
  if (!found) return { url, note: "Swagger UI 페이지인데 그 페이지가 읽는 문서를 찾지 못했다. 문서 자체의 주소(보통 /v3/api-docs나 …-json)를 적는다" };
  if (found.inline) return { url, note: "문서가 페이지의 스크립트 안에 들어 있어 따로 된 주소가 없다. 페이지 주소를 그대로 저장했다" };
  return { url: found.url, resolvedFrom: url };
}

/** 출처를 더한다. 같은 이름이 있으면 바꾼다. `path`의 파일은 있어야 한다(`check`가 같은 것을 본다). */
export async function addSource(repo: Repo, name: string | undefined, options: AddSourceOptions): Promise<AddSourceResult> {
  if (!name) throw new Refusal("출처 이름이 필요하다: openapi add <이름> --url <주소> | --path <경로>");
  const hasUrl = options.url !== undefined && options.url !== "";
  const hasPath = options.path !== undefined && options.path !== "";
  if (hasUrl === hasPath) throw new Refusal("--url과 --path 가운데 하나만 준다");
  let source: SourceConfig = hasUrl ? { name, url: options.url as string } : { name, path: (options.path as string).replace(/\\/g, "/") };
  if (source.path && !fs.existsSync(path.join(repo.root, source.path))) throw new Refusal(`파일이 없다: ${source.path} (저장소 루트 기준)`);
  let resolvedFrom: string | undefined;
  let note: string | undefined;
  if (source.url) {
    if (!/^https?:\/\//.test(source.url)) throw new Refusal("url은 http(s)로 시작한다");
    const resolved = await resolveUrl(source.url, options.fetchImpl ?? fetch);
    source = { name, url: resolved.url };
    resolvedFrom = resolved.resolvedFrom;
    note = resolved.note;
  }

  const current = listSources(repo);
  const replaced = current.some((item) => item.name === name);
  const next = replaced ? current.map((item) => (item.name === name ? source : item)) : [...current, source];
  try {
    validateSources({ sources: next });
  } catch (error) {
    throw new Refusal(error instanceof Error ? error.message : String(error));
  }
  writeSource(repo, { put: source }, current);
  return { source, replaced, ...(resolvedFrom ? { resolvedFrom } : {}), ...(note ? { note } : {}), sources: next };
}

export function removeSource(repo: Repo, name: string | undefined): { removed: SourceConfig; sources: SourceConfig[] } {
  if (!name) throw new Refusal("출처 이름이 필요하다: openapi remove <이름>");
  const current = listSources(repo);
  const removed = current.find((item) => item.name === name);
  if (!removed) throw new Refusal(`그런 출처가 없다: ${name} (있는 것: ${current.map((item) => item.name).join(", ") || "없음"})`);
  const next = current.filter((item) => item.name !== name);
  writeSource(repo, { remove: name }, current);
  return { removed, sources: next };
}

export function formatSources(sources: SourceConfig[]): string {
  if (sources.length === 0) return "OpenAPI 출처가 없다. openapi add <이름> --url <주소> | --path <경로>로 더한다.";
  return sources.map((source) => `- ${source.name}: ${source.url ?? source.path}${source.path ? " (파일)" : ""}`).join("\n");
}
