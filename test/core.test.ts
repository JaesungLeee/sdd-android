import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatDoc, formatMeta, parseDoc, type Meta } from "../src/core/frontmatter.js";
import { diffHashes, formatHashFile, hashBody, hashSource, isUnchanged, parseHashFile } from "../src/core/hash.js";
import { splitItems } from "../src/core/items.js";
import { normalizeText } from "../src/core/normalize.js";
import { openRepo, type Repo } from "../src/core/repo.js";
import { bumpVersion, compareVersions, gradeBetween, maxGrade } from "../src/core/version.js";

describe("version", () => {
  it("버전을 수로 비교한다", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.3", "2.0.0")).toBe(-1);
  });

  it("등급에 따라 버전을 올린다", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
  });

  it("버전 번호의 차이로 등급을 낸다", () => {
    expect(gradeBetween("1.0.0", "2.1.0")).toBe("major");
    expect(gradeBetween("1.0.0", "1.1.5")).toBe("minor");
    expect(gradeBetween("1.0.0", "1.0.1")).toBe("patch");
    expect(gradeBetween("1.0.0", "1.0.0")).toBeNull();
  });

  it("가장 큰 등급을 고른다", () => {
    expect(maxGrade(["patch", "major", "minor"])).toBe("major");
    expect(maxGrade([])).toBeNull();
  });
});

describe("normalizeText", () => {
  it("줄바꿈, 줄 끝 공백, 끝의 빈 줄, 유니코드 형태의 차이를 없앤다", () => {
    const decomposed = "한글".normalize("NFD");
    expect(normalizeText(`a  \r\n${decomposed}\t\r\n\r\n\r\n`)).toBe("a\n한글");
  });

  it("줄 안의 공백과 가운데 빈 줄은 그대로 둔다", () => {
    expect(normalizeText("a  b\n\n\n    code")).toBe("a  b\n\n\n    code");
  });

  it("요청하면 체크 표시를 빈 것으로 바꾼다", () => {
    expect(normalizeText("- [x] T001 a\n- [X] T002 b\n- [ ] T003 c", { uncheck: true })).toBe(
      "- [ ] T001 a\n- [ ] T002 b\n- [ ] T003 c",
    );
    expect(normalizeText("- [x] T001 a")).toBe("- [x] T001 a");
  });
});

const PRD_BODY = [
  "# 제목",
  "",
  "머리말",
  "",
  "## 기능",
  "",
  "### [CLI-001] 설치",
  "",
  "설치한다.",
  "",
  "#### 세부",
  "",
  "세부 내용",
  "",
  "### [CLI-002] 갱신",
  "",
  "```text",
  "### [X-001] 코드 블록 안의 제목",
  "```",
  "",
  "## 성공 기준",
  "",
  "기준",
].join("\n");

describe("splitItems", () => {
  const split = splitItems(PRD_BODY);

  it("제목의 ID로 항목을 찾는다", () => {
    expect([...split.items.keys()]).toEqual(["CLI-001", "CLI-002"]);
  });

  it("더 낮은 수준의 제목은 항목 안에 둔다", () => {
    expect(split.items.get("CLI-001")).toContain("세부 내용");
  });

  it("더 높은 수준의 제목에서 항목이 끝난다", () => {
    expect(split.items.get("CLI-002")).not.toContain("성공 기준");
    expect(split.outside).toContain("## 성공 기준");
    expect(split.outside).toContain("기준");
  });

  it("코드 블록 안의 제목은 제목으로 보지 않는다", () => {
    expect(split.items.has("X-001")).toBe(false);
    expect(split.items.get("CLI-002")).toContain("### [X-001]");
  });

  it("중복된 ID를 알린다", () => {
    expect(splitItems("### [A-001] 하나\n\n### [A-001] 둘").duplicates).toEqual(["A-001"]);
  });
});

describe("hashBody", () => {
  it("prd는 항목마다, 그리고 항목 밖을 따로 해시한다", () => {
    expect(Object.keys(hashBody("prd", PRD_BODY)).sort()).toEqual(["*", "CLI-001", "CLI-002"]);
  });

  it("바뀐 항목, 새 항목, 지워진 항목, 항목 밖의 변경을 가른다", () => {
    const before = hashBody("prd", PRD_BODY);
    const after = hashBody(
      "prd",
      PRD_BODY.replace("설치한다.", "설치하고 기록한다.")
        .replace("머리말", "새 머리말")
        .replace("### [CLI-002] 갱신", "### [CLI-003] 점검"),
    );
    expect(diffHashes(before, after)).toEqual({
      changed: ["*", "CLI-001"],
      added: ["CLI-003"],
      removed: ["CLI-002"],
    });
  });

  it("제목만 바뀌어도 바뀐 것으로 본다", () => {
    const after = hashBody("prd", PRD_BODY.replace("[CLI-001] 설치", "[CLI-001] 설치하기"));
    expect(diffHashes(hashBody("prd", PRD_BODY), after).changed).toEqual(["CLI-001"]);
  });

  it("항목의 순서만 바뀐 것은 바뀐 것으로 보지 않는다", () => {
    const a = "### [A-001] 하나\n\n내용 1\n\n### [A-002] 둘\n\n내용 2";
    const b = "### [A-002] 둘\n\n내용 2\n\n### [A-001] 하나\n\n내용 1";
    expect(isUnchanged(diffHashes(hashBody("prd", a), hashBody("prd", b)))).toBe(true);
  });

  it("줄바꿈 방식이 달라도 같은 해시를 낸다", () => {
    expect(hashBody("prd", PRD_BODY.replace(/\n/g, "\r\n"))).toEqual(hashBody("prd", PRD_BODY));
  });

  it("breakdown은 체크 상태를 해시에 넣지 않는다", () => {
    expect(hashBody("breakdown", "- [x] T001 a `src/a.ts`")).toEqual(hashBody("breakdown", "- [ ] T001 a `src/a.ts`"));
    expect(hashBody("spec", "- [x] a")).not.toEqual(hashBody("spec", "- [ ] a"));
  });
});

describe("해시 파일", () => {
  it("version, 항목 밖, 항목 순으로 적고 그대로 다시 읽는다", () => {
    const file = { version: "1.2.0", hashes: { "CLI-002": "b", "*": "o", "CLI-001": "a" } };
    const text = formatHashFile(file);
    expect(text).toBe("version 1.2.0\n* o\nCLI-001 a\nCLI-002 b\n");
    expect(parseHashFile(text)).toEqual(file);
  });
});

describe("경로의 내용 해시", () => {
  function gitRepo(): Repo {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-android-hash-"));
    fs.mkdirSync(path.join(root, ".sdd-android"));
    fs.writeFileSync(path.join(root, ".sdd-android", "config.yaml"), "language: ko\nagent: claude-code\ndocs_dir: docs\nprefix: \"\"\n");
    fs.writeFileSync(path.join(root, ".gitignore"), "build/\n");
    execFileSync("git", ["-C", root, "init", "-q", "-b", "main"], { stdio: "ignore" });
    return openRepo(root);
  }
  function write(repo: Repo, rel: string, text: string): void {
    const file = path.join(repo.root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }

  it("파일은 줄바꿈, 줄 끝 공백, 끝의 빈 줄, NFC를 무시하고 바이너리는 바이트 그대로다", () => {
    const repo = gitRepo();
    write(repo, "core/A.kt", "class A\n");
    const base = hashSource(repo, "core/A.kt");
    write(repo, "core/A.kt", "class A  \r\n\r\n");
    expect(hashSource(repo, "core/A.kt")).toBe(base);
    write(repo, "core/A.kt", "class A2\n");
    expect(hashSource(repo, "core/A.kt")).not.toBe(base);
    write(repo, "assets/pic.bin", "\u0000\u0001");
    const bin = hashSource(repo, "assets/pic.bin");
    write(repo, "assets/pic.bin", "\u0000\u0002");
    expect(hashSource(repo, "assets/pic.bin")).not.toBe(bin);
    expect(hashSource(repo, "core/없음.kt")).toBeUndefined();
  });

  it("디렉터리는 git이 보는 파일 전체이고, 무시되는 파일은 들어가지 않으며, 커밋 전의 변경과 새 파일도 반영된다", () => {
    const repo = gitRepo();
    write(repo, "core/A.kt", "class A\n");
    write(repo, "core/B.kt", "class B\n");
    const base = hashSource(repo, "core/");
    expect(hashSource(repo, "core")).toBe(base);
    write(repo, "core/build/out.class", "x");
    expect(hashSource(repo, "core/")).toBe(base);
    write(repo, "core/C.kt", "class C\n");
    const withNew = hashSource(repo, "core/");
    expect(withNew).not.toBe(base);
    write(repo, "core/B.kt", "class B2\n");
    expect(hashSource(repo, "core/")).not.toBe(withNew);
  });
});

describe("frontmatter", () => {
  const meta: Meta = {
    version: "1.2.0",
    status: "created",
    created: "2026-10-04",
    updated: "2026-10-10",
    revisions: [
      { version: "1.0.0", date: "2026-10-04" },
      { version: "1.1.0", date: "2026-10-07", items: { "CLI-001": "minor" } },
      { version: "1.2.0", date: "2026-10-10", items: { "SYS-003": "patch", "*": "patch" } },
    ],
  };

  it("정한 모양으로 적는다", () => {
    expect(formatMeta(meta)).toBe(
      [
        "version: 1.2.0",
        "status: created",
        "created: 2026-10-04",
        "updated: 2026-10-10",
        "revisions:",
        "  - version: 1.0.0",
        "    date: 2026-10-04",
        "  - version: 1.1.0",
        "    date: 2026-10-07",
        "    items: { CLI-001: minor }",
        "  - version: 1.2.0",
        "    date: 2026-10-10",
        '    items: { SYS-003: patch, "*": patch }',
        "",
      ].join("\n"),
    );
  });

  it("적은 것을 그대로 다시 읽는다", () => {
    const parsed = parseDoc(formatDoc(meta, "# 본문\n"));
    expect(parsed.error).toBeUndefined();
    expect(parsed.meta).toEqual(meta);
    expect(parsed.body).toBe("# 본문\n");
  });

  it("based_on을 적고 다시 읽는다", () => {
    const spec: Meta = {
      version: "1.0.0",
      status: "created",
      based_on: { prd: { version: "1.2.0", items: ["CLI-001", "SYS-003"] } },
      created: "2026-10-11",
      updated: "2026-10-11",
    };
    expect(formatMeta(spec)).toContain("  prd: { version: 1.2.0, items: [CLI-001, SYS-003] }");
    expect(parseDoc(formatDoc(spec, "")).meta).toEqual(spec);
  });

  it("draft 문서에는 version을 적지 않는다", () => {
    expect(formatMeta({ status: "draft", created: "2026-10-04" })).toBe("status: draft\ncreated: 2026-10-04\n");
  });

  it("frontmatter가 없는 문서를 알아본다", () => {
    const parsed = parseDoc("# 제목\n");
    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.body).toBe("# 제목\n");
  });

  it("충돌 표시가 남은 frontmatter를 오류로 알린다", () => {
    const text = "---\n<<<<<<< HEAD\nversion: 1.1.0\n=======\nversion: 1.2.0\n>>>>>>> other\n---\n본문\n";
    expect(parseDoc(text).error).toContain("충돌 표시");
  });

  it("닫히지 않은 frontmatter를 오류로 알린다", () => {
    expect(parseDoc("---\nversion: 1.0.0\n본문\n").error).toContain("닫히지 않았다");
  });
});

describe("항목 끝의 구분선", () => {
  const head = "# 3\n\n### [A-001] 하나\n\n내용\n";
  const tail = "\n---\n\n# 4\n\n끝\n";
  const added = "\n### [A-002] 둘\n\n내용\n";

  it("구분선 앞에 새 항목을 더해도 앞 항목과 항목 밖은 바뀌지 않는다", () => {
    const before = hashBody("prd", head + tail);
    const after = hashBody("prd", head + added + tail);
    const diff = diffHashes(before, after);
    expect(diff.added).toEqual(["A-002"]);
    expect(diff.changed).toEqual([]);
  });

  it("구분선은 항목 밖에 남는다", () => {
    expect(splitItems(head + tail).outside).toContain("---");
    expect(splitItems(head + tail).items.get("A-001")).toBe("### [A-001] 하나\n\n내용");
  });
});
