import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { status } from "../src/commands/status.js";
import { wikiCategoryAdd, wikiIndex, wikiLint, wikiRecord, wikiSources } from "../src/commands/wiki.js";
import { openRepo, Refusal, type Repo } from "../src/core/repo.js";
import { categories, extractLinks, hashSource, listPages, resolveLink } from "../src/core/wiki.js";

let repo: Repo;

function git(...args: string[]): string {
  return execFileSync("git", ["-C", repo.root, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
function commit(message: string): string {
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "--short", "HEAD");
}
function write(rel: string, text: string): void {
  const file = path.join(repo.root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function read(rel: string): string {
  return fs.readFileSync(path.join(repo.root, ...rel.split("/")), "utf8");
}
function page(title: string, sources: string[], body = "본문\n", extra = ""): string {
  const list = sources.length === 0 ? "sources: []\n" : `sources:\n${sources.map((source) => `  - path: ${source}\n`).join("")}`;
  return `---\ntitle: ${title}\nsummary: ${title}의 요약\n${extra}${list}---\n${body}`;
}
const problems = (kind: string) => wikiLint(repo).problems.filter((problem) => problem.kind === kind);

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mob-sdd-wiki-"));
  fs.mkdirSync(path.join(root, ".mob-sdd"));
  fs.writeFileSync(path.join(root, ".mob-sdd", "config.yaml"), "language: ko\nagent: claude-code\ndocs_dir: docs\nprefix: \"\"\n");
  fs.writeFileSync(path.join(root, ".gitignore"), "build/\n");
  repo = openRepo(root);
  git("init", "-q", "-b", "main");
  write("core/A.kt", "class A\n");
  write("core/B.kt", "class B\n");
  commit("코드");
});

describe("갈래", () => {
  it("기본 네 갈래에 설정의 갈래를 더하고, 더한 것은 설정 파일의 다른 내용을 보존한 채 적힌다", () => {
    expect(Object.keys(categories(repo))).toEqual(["architecture", "conventions", "adr", "failures"]);
    write(".mob-sdd/config.yaml", "# 설정\nlanguage: ko\ndocs_dir: docs # 산출물\nprefix: \"\"\n");
    repo = openRepo(repo.root);
    wikiCategoryAdd(repo, "domain", "도메인 용어");
    expect(read(".mob-sdd/config.yaml")).toContain("# 설정");
    expect(read(".mob-sdd/config.yaml")).toContain("docs_dir: docs # 산출물");
    expect(openRepo(repo.root).config.wiki).toEqual({ categories: { domain: "도메인 용어" } });
    expect(categories(repo).domain).toBe("도메인 용어");
  });

  it("이름의 형식과 중복, 빈 설명을 거부한다", () => {
    expect(() => wikiCategoryAdd(repo, "Domain", "x")).toThrow(Refusal);
    expect(() => wikiCategoryAdd(repo, "adr", "x")).toThrow(/이미 있는 갈래/);
    expect(() => wikiCategoryAdd(repo, "raw", "x")).toThrow(/이미 있는 갈래/);
    expect(() => wikiCategoryAdd(repo, "domain", "  ")).toThrow(/설명/);
    expect(() => wikiCategoryAdd(repo, undefined, "x")).toThrow(/이름/);
  });
});

describe("원본의 해시", () => {
  it("파일은 줄바꿈, 줄 끝 공백, 끝의 빈 줄, NFC를 무시하고 바이너리는 바이트 그대로다", () => {
    const base = hashSource(repo, "core/A.kt");
    write("core/A.kt", "class A  \r\n\r\n");
    expect(hashSource(repo, "core/A.kt")).toBe(base);
    write("core/A.kt", "class A2\n");
    expect(hashSource(repo, "core/A.kt")).not.toBe(base);
    write("docs/wiki/raw/pic.bin", "\u0000\u0001");
    const bin = hashSource(repo, "docs/wiki/raw/pic.bin");
    write("docs/wiki/raw/pic.bin", "\u0000\u0002");
    expect(hashSource(repo, "docs/wiki/raw/pic.bin")).not.toBe(bin);
    expect(hashSource(repo, "core/없음.kt")).toBeUndefined();
  });

  it("디렉터리는 git이 보는 파일 전체이고, 무시되는 파일은 들어가지 않으며, 커밋 전의 변경과 새 파일도 반영된다", () => {
    const base = hashSource(repo, "core/");
    expect(hashSource(repo, "core")).toBe(base);
    write("core/build/out.class", "x");
    expect(hashSource(repo, "core/")).toBe(base);
    write("core/C.kt", "class C\n");
    const withNew = hashSource(repo, "core/");
    expect(withNew).not.toBe(base);
    write("core/B.kt", "class B2\n");
    expect(hashSource(repo, "core/")).not.toBe(withNew);
  });
});

describe("기록과 색인", () => {
  it("record가 sources의 해시와 commit을 적고 색인을 만들며, 원본이 없으면 해시를 비운다", () => {
    write("docs/wiki/architecture/modules.md", page("모듈 구조", ["core/", "core/없음.kt"], "[개요](overview.md)\n"));
    write("docs/wiki/architecture/overview.md", page("개요", ["core/A.kt"]));
    const head = commit("페이지");
    const result = wikiRecord(repo, ["docs/wiki/architecture/modules.md", "architecture/overview.md"]);
    expect(result.commit).toBe(head);
    expect(result.pages[0]?.sources).toEqual([{ path: "core/", sha256: hashSource(repo, "core/") }, { path: "core/없음.kt" }]);
    const text = read("docs/wiki/architecture/modules.md");
    expect(text).toMatch(/^---\ntitle: 모듈 구조\nsummary: 모듈 구조의 요약\nsources:\n  - path: core\/\n    sha256: [0-9a-f]{64}\n  - path: core\/없음.kt\ncommit: [0-9a-f]+\n---\n\[개요\]/);
    const index = read("docs/wiki/index.md");
    expect(index).toContain("## architecture");
    expect(index).toContain("- [모듈 구조](architecture/modules.md): 모듈 구조의 요약");
    expect(index).toContain("## adr\n\n결정 기록\n\n- (페이지 없음)");
    expect(problems("source-missing").map((p) => p.message)).toEqual(["원본이 없다: core/없음.kt"]);
    expect(problems("stale")).toEqual([]);
    expect(problems("index")).toEqual([]);
  });

  it("record는 없는 페이지, 위키 밖, raw, 색인, 깨진 frontmatter를 거부한다", () => {
    write("docs/wiki/raw/memo.md", "메모\n");
    write("docs/wiki/adr/broken.md", "---\ntitle: [\n---\n");
    write("docs/wiki/index.md", "# 색인\n");
    expect(() => wikiRecord(repo, [])).toThrow(/경로/);
    expect(() => wikiRecord(repo, ["docs/wiki/adr/none.md"])).toThrow(/페이지가 없다/);
    expect(() => wikiRecord(repo, ["core/A.kt"])).toThrow(/위키 밖/);
    expect(() => wikiRecord(repo, ["raw/memo.md"])).toThrow(/raw/);
    expect(() => wikiRecord(repo, ["index.md"])).toThrow(/갈래 아래/);
    expect(() => wikiRecord(repo, ["adr/broken.md"])).toThrow(/frontmatter를 읽을 수 없다/);
  });

  it("색인은 기본 갈래 순서 뒤에 더한 갈래가 오고, 깨진 페이지는 싣지 않고 알린다", () => {
    write("docs/wiki/adr/.keep", "");
    wikiIndex(repo);
    expect(wikiCategoryAdd(repo, "domain", "도메인").index?.file).toBe("docs/wiki/index.md");
    expect(read("docs/wiki/index.md")).toContain("## domain");
    write("docs/wiki/domain/terms.md", page("용어", []));
    write("docs/wiki/conventions/bad.md", "본문만\n");
    const result = wikiIndex(repo);
    expect(result.pages).toBe(1);
    expect(result.skipped).toEqual([{ page: "conventions/bad.md", error: "frontmatter가 없다" }]);
    const index = read("docs/wiki/index.md");
    expect(index.indexOf("## failures")).toBeLessThan(index.indexOf("## domain"));
    expect(index).toContain("## domain\n\n도메인\n\n- [용어](domain/terms.md): 용어의 요약");
  });
});

describe("낡음 판정", () => {
  beforeEach(() => {
    write("docs/wiki/architecture/overview.md", page("개요", ["core/"]));
    commit("페이지");
    wikiRecord(repo, ["architecture/overview.md"]);
    commit("기록");
  });

  it("원본이 바뀌면 낡음 후보이고, commit이 이력에 있으면 diff로 읽으라고 알린다", () => {
    expect(problems("stale")).toEqual([]);
    write("core/A.kt", "class A2\n");
    const [stale] = problems("stale");
    expect(stale?.commitInHistory).toBe(true);
    expect(stale?.message).toMatch(/git diff [0-9a-f]+ -- core\//);
    wikiRecord(repo, ["architecture/overview.md"]);
    expect(problems("stale")).toEqual([]);
  });

  it("squash 병합으로 commit이 이력에서 사라져도 원본이 같으면 낡음 후보가 아니다", () => {
    git("checkout", "-q", "-b", "topic");
    write("core/A.kt", "class A2\n");
    const topic = commit("브랜치에서 원본 변경");
    write("docs/wiki/architecture/overview.md", page("개요", ["core/"], "고친 본문\n"));
    wikiRecord(repo, ["architecture/overview.md"]);
    commit("브랜치에서 기록");
    git("checkout", "-q", "main");
    git("merge", "--squash", "topic");
    commit("squash");
    git("branch", "-D", "topic");
    expect(read("docs/wiki/architecture/overview.md")).toContain(`commit: ${topic}`);
    expect(problems("stale")).toEqual([]);
    write("core/B.kt", "class B2\n");
    expect(problems("stale")[0]?.commitInHistory).toBe(false);
    expect(problems("stale")[0]?.message).toContain("원본을 다시 읽는다");
  });

  it("커밋하지 않은 변경 상태에서 기록한 페이지는 커밋한 뒤에도 낡음 후보가 아니다", () => {
    write("core/A.kt", "class A3\n");
    wikiRecord(repo, ["architecture/overview.md"]);
    expect(problems("stale")).toEqual([]);
    commit("원본 변경을 커밋");
    expect(problems("stale")).toEqual([]);
  });
});

describe("점검", () => {
  it("형식, 깨진 링크, 원본 없는 페이지, 고아, 색인 불일치를 낸다", () => {
    write("docs/wiki/architecture/a.md", page("A", ["core/A.kt"], "[B](b.md) [밖](../../../core/A.kt) [없음](c.md) [웹](https://x.y) [같은 쪽](#절)\n"));
    write("docs/wiki/architecture/b.md", page("B", []));
    write("docs/wiki/adr/2026-10-08-old.md", page("옛 결정", ["core/B.kt"], "", "status: superseded\n"));
    write("docs/wiki/adr/2026-10-09-new.md", "---\nsummary: 요약만\nsources: x\n---\n");
    wikiRecord(repo, ["architecture/a.md", "architecture/b.md", "adr/2026-10-08-old.md"]);
    const found = wikiLint(repo);
    expect(found.pages).toBe(4);
    const by = (kind: string) => found.problems.filter((p) => p.kind === kind).map((p) => `${p.page}: ${p.message}`);
    expect(by("broken-link")).toEqual(["architecture/a.md: 가리키는 파일이 없다: c.md"]);
    expect(by("unsourced")).toEqual(["architecture/b.md: 원본(sources)이 없다"]);
    expect(by("format")).toEqual(["adr/2026-10-08-old.md: superseded인데 superseded_by가 없다", "adr/2026-10-09-new.md: sources가 목록이 아니다"]);
    expect(by("orphan")).toEqual(["adr/2026-10-08-old.md: 어떤 페이지도 이 페이지를 링크하지 않는다", "architecture/a.md: 어떤 페이지도 이 페이지를 링크하지 않는다"]);
    expect(by("index")).toEqual([]);
    write("docs/wiki/architecture/b.md", page("B2", []));
    expect(by("index")).toEqual([]);
    expect(problems("index").map((p) => p.message)).toEqual(["색인이 페이지 목록과 다르다. wiki index로 다시 만든다"]);
    fs.rmSync(path.join(repo.root, "docs/wiki/index.md"));
    expect(problems("index").map((p) => p.message)).toEqual(["색인이 없다. wiki index로 만든다"]);
  });

  it("superseded_by는 위키 루트 기준이고 링크로 센다", () => {
    write("docs/wiki/adr/2026-10-08-old.md", page("옛", [], "", "status: superseded\nsuperseded_by: adr/2026-10-09-new.md\n"));
    write("docs/wiki/adr/2026-10-09-new.md", page("새", [], "[옛](2026-10-08-old.md)\n", "status: accepted\n"));
    wikiIndex(repo);
    expect(problems("format")).toEqual([]);
    expect(problems("broken-link")).toEqual([]);
    expect(problems("orphan")).toEqual([]);
  });

  it("링크를 뽑고 푼다", () => {
    expect(extractLinks("[a](x.md) ![i](img.png) [b](<y z.md> \"t\") [c](mailto:a@b) [d](#top)")).toEqual(["x.md", "img.png", "y z.md"]);
    expect(resolveLink(repo, "adr/a.md", "../architecture/b.md#절")).toEqual({ wiki: "architecture/b.md" });
    expect(resolveLink(repo, "adr/a.md", "/core/A.kt")).toEqual({ outside: "core/A.kt" });
    expect(resolveLink(repo, "adr/a.md", "../../../core/A.kt")).toEqual({ outside: "core/A.kt" });
  });
});

describe("미수집 원본과 status", () => {
  it("리서치 기록(blueprint 완료), 실패 기록, raw를 세고, 어느 페이지의 원본이든 덮이면 빠진다", () => {
    write("docs/specs/login/blueprint.md", "---\nversion: 1.0.0\nstatus: created\n---\n# 설계\n");
    write("docs/specs/login/research.md", "# 리서치\n");
    write("docs/specs/login/failures.md", "# 실패\n");
    write("docs/specs/signup/blueprint.md", "---\nstatus: draft\n---\n# 설계\n");
    write("docs/specs/signup/research.md", "# 리서치\n");
    write("docs/wiki/raw/meeting.md", "회의\n");
    write("docs/wiki/raw/plan.pdf", "\u0000pdf");
    expect(wikiSources(repo).uncollected).toEqual(["docs/specs/login/research.md", "docs/specs/login/failures.md", "docs/wiki/raw/meeting.md", "docs/wiki/raw/plan.pdf"]);
    write("docs/wiki/adr/2026-10-08-x.md", page("결정", ["docs/specs/login/research.md"], "", "status: accepted\n"));
    write("docs/wiki/failures/login.md", page("로그인 실패", ["docs/specs/login/", "docs/wiki/raw/"]));
    wikiRecord(repo, ["adr/2026-10-08-x.md", "failures/login.md"]);
    expect(wikiSources(repo).uncollected).toEqual([]);
    write("docs/wiki/raw/meeting.md", "회의록을 고쳤다\n");
    expect(wikiSources(repo).stale).toEqual([{ page: "failures/login.md", sources: ["docs/wiki/raw/"] }]);
  });

  it("status는 위키가 없으면 아무것도 더하지 않고, 있으면 한 줄을 더한다", () => {
    expect(status(repo).wiki).toBeUndefined();
    write("docs/wiki/architecture/overview.md", page("개요", ["core/"]));
    write("docs/wiki/raw/memo.md", "메모\n");
    wikiRecord(repo, ["architecture/overview.md"]);
    write("core/A.kt", "class A9\n");
    expect(status(repo).wiki).toEqual({ pages: 1, stale: 1, uncollected: 1 });
    expect(listPages(repo).map((p) => p.rel)).toEqual(["architecture/overview.md"]);
  });
});
