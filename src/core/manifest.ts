import fs from "node:fs";
import path from "node:path";
import { sha256 } from "./hash.js";

export interface ManifestEntry {
  sha256: string;
  /** `core`이거나 extension, preset의 이름. */
  source: string;
  /** preset이 교체한 코어 파일이면, 교체 당시의 코어 파일 해시. upgrade가 코어의 변경을 알리는 데 쓴다. */
  core?: string;
}

export interface InstalledExtension {
  kind: "extension" | "preset";
  version: string;
  /** 패키지에 내장된 것인지, 로컬 경로에서 설치한 것인지. 경로는 사람마다 달라 적지 않는다. */
  origin: "builtin" | "local";
}

export interface Manifest {
  /** 설치된 sdd-first의 버전. */
  version: string;
  files: Record<string, ManifestEntry>;
  extensions?: Record<string, InstalledExtension>;
}

export function manifestPath(root: string): string {
  return path.join(root, ".sdd-first", "manifest.json");
}

/** 설치 파일의 해시. 줄바꿈 변환 설정이 달라도 같은 값이 나오게 줄바꿈만 통일한다. */
export function hashContent(content: string | Buffer): string {
  return sha256(content.toString("utf8").replace(/\r\n?/g, "\n"));
}

export function readManifest(root: string): Manifest | undefined {
  const file = manifestPath(root);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
}

/** 경로를 정렬해 쓴다. 같은 설치면 같은 파일이 나온다. 날짜는 적지 않는다. */
export function writeManifest(root: string, manifest: Manifest): void {
  const files: Record<string, ManifestEntry> = {};
  for (const key of Object.keys(manifest.files).sort()) files[key] = manifest.files[key] as ManifestEntry;
  fs.mkdirSync(path.dirname(manifestPath(root)), { recursive: true });
  const extensions: Record<string, InstalledExtension> = {};
  for (const key of Object.keys(manifest.extensions ?? {}).sort()) extensions[key] = (manifest.extensions ?? {})[key] as InstalledExtension;
  fs.writeFileSync(manifestPath(root), JSON.stringify({ version: manifest.version, files, extensions }, null, 2) + "\n");
}
