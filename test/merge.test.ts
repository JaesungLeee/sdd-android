import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { check } from "../src/commands/check.js";
import { docChanges, docChecklist, docComplete, docConfirm, docNew, docRestore, docRevise } from "../src/commands/doc.js";
import { stageGate } from "../src/commands/gate.js";
import { status } from "../src/commands/status.js";
import { docPath, loadDoc, openRepo, Refusal, type Repo } from "../src/core/repo.js";

const PRD = [
  "# PRD",
  "",
  "머리말",
  "",
  "### [CLI-001] 설치",
  "",
  "설치한다.",
  "",
  "설치의 둘째 문단.",
  "",
  "설치의 셋째 문단.",
  "",
  "### [CLI-002] 갱신",
  "",
  "갱신한다.",
  "",
  "갱신의 둘째 문단.",
  "",
  "# 끝",
  "",
  "맺음말",
  "",
].join("\n");

const TEMPLATES: Record<string, string> = {
  prd: PRD,
  spec: "# 스펙\n\n요구사항\n",
  checklist: "# 체크리스트\n\n- [ ] 하나\n",
};

let repo: Repo;
const today = { today: "2026-10-05" };

/** 충돌로 끝나는 명령도 있으므로 실패를 던지지 않고 성공 여부를 돌려준다. */
function git(...args: string[]): boolean {
  try {
    execFileSync("git", ["-C", repo.root, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], {
      stdio: "ignore",
      env: { ...process.env, GIT_EDITOR: "true" },
    });
    return true;
  } catch {
    return false;
  }
}

function commit(message: string): void {
  git("add", "-A");
  git("commit", "-m", message);
}

function edit(change: (text: string) => string): void {
  const file = docPath(repo, "prd");
  fs.writeFileSync(file, change(fs.readFileSync(file, "utf8")));
}

/** 같은 문서를 두 브랜치가 각각 개정한 상태를 만든다. `a`는 CLI-001을, `b`는 CLI-002를 고친다. */
function diverge(): void {
  git("checkout", "-b", "a");
  edit((text) => text.replace("설치한다.", "한 줄로 설치한다."));
  docRevise(repo, "prd", undefined, { ...today, grades: { "CLI-001": "minor" } });
  commit("a");

  git("checkout", "-b", "b", "base");
  edit((text) => text.replace("갱신한다.", "새 버전으로 갱신한다."));
  docRevise(repo, "prd", undefined, { ...today, grades: { "CLI-002": "patch" } });
  commit("b");
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mob-sdd-merge-"));
  fs.mkdirSync(path.join(root, ".mob-sdd", "templates"), { recursive: true });
  fs.writeFileSync(path.join(root, ".mob-sdd", "config.yaml"), "language: ko\ndocs_dir: docs\n");
  for (const [name, body] of Object.entries(TEMPLATES)) {
    fs.writeFileSync(path.join(root, ".mob-sdd", "templates", `${name}.md`), body);
  }
  repo = openRepo(root);
  git("init", "-b", "base");
  docNew(repo, "prd", undefined, today);
  docComplete(repo, "prd", undefined, today);
  commit("base");
});

describe("병합 뒤 정리", () => {
  it("두 브랜치의 개정을 병합하면 충돌로 판정하고, 판정을 내는 명령이 죽지 않는다", () => {
    diverge();
    git("checkout", "a");
    expect(git("merge", "b")).toBe(false);

    expect(loadDoc(repo, "prd")?.conflict).toBe(true);
    expect(stageGate(repo, "prd").mode).toBe("conflict");
    expect(() => status(repo)).not.toThrow();
    expect(check(repo).ok).toBe(false);
  });

  it("HEAD의 기록으로 되돌리면 들어온 변경이 바뀐 곳으로 나오고 새 버전으로 기록된다", () => {
    diverge();
    git("checkout", "a");
    git("merge", "b");

    const restored = docRestore(repo, "prd", undefined);
    expect(restored.version).toBe("1.1.0");
    expect(restored.restored).toEqual(["docs/prd.md", ".mob-sdd/hashes/prd.md.hash"]);

    const doc = loadDoc(repo, "prd");
    expect(doc?.conflict).toBe(false);
    expect(doc?.meta.revisions?.at(-1)?.items).toEqual({ "CLI-001": "minor" });
    expect(doc?.body).toContain("한 줄로 설치한다.");
    expect(doc?.body).toContain("새 버전으로 갱신한다.");

    expect(docChanges(repo, "prd", undefined)).toMatchObject({ changed: ["CLI-002"], added: [], removed: [] });
    expect(docRevise(repo, "prd", undefined, { ...today, grades: { "CLI-002": "patch" } }).version).toBe("1.1.1");
    // 이 저장소에는 설치 기록이 없으므로 문서에 대한 오류만 본다.
    expect(check(repo).problems.filter((problem) => problem.level === "error" && problem.where.startsWith("docs/"))).toEqual([]);
  });

  it("rebase에서도 HEAD(올려놓는 쪽)의 기록이 기준이다", () => {
    diverge();
    expect(git("rebase", "a")).toBe(false);

    expect(docRestore(repo, "prd", undefined).version).toBe("1.1.0");
    expect(loadDoc(repo, "prd")?.meta.revisions?.at(-1)?.items).toEqual({ "CLI-001": "minor" });
    expect(docChanges(repo, "prd", undefined).changed).toEqual(["CLI-002"]);
  });

  it("본문에 충돌 표시가 남아 있으면 되돌리지 않는다", () => {
    git("checkout", "-b", "a");
    edit((text) => text.replace("설치한다.", "가 방식으로 설치한다."));
    docRevise(repo, "prd", undefined, { ...today, grades: { "CLI-001": "minor" } });
    commit("a");
    git("checkout", "-b", "b", "base");
    edit((text) => text.replace("설치한다.", "나 방식으로 설치한다."));
    docRevise(repo, "prd", undefined, { ...today, grades: { "CLI-001": "minor" } });
    commit("b");
    git("checkout", "a");
    git("merge", "b");

    expect(() => docRestore(repo, "prd", undefined)).toThrow(/본문에 충돌 표시/);
    edit((text) => text.replace(/<<<<<<< .*\n(가 방식[^\n]*)\n=======\n[^\n]*\n>>>>>>> .*\n/, "$1 나 방식도 된다.\n"));
    expect(docRestore(repo, "prd", undefined).version).toBe("1.1.0");
    expect(docChanges(repo, "prd", undefined).changed).toEqual(["CLI-001"]);
  });

  it("HEAD에 없는 문서와 깨진 기준은 거부한다", () => {
    expect(() => docRestore(repo, "prd", undefined, { from: "no-such-commit" })).toThrow(Refusal);
    diverge();
    git("checkout", "a");
    git("merge", "b");
    commit("충돌 표시를 그대로 커밋");
    expect(() => docRestore(repo, "prd", undefined)).toThrow(/--from/);
    expect(docRestore(repo, "prd", undefined, { from: "HEAD~1" }).version).toBe("1.1.0");
  });

  it("번호가 겹친 항목은 어느 쪽이 들어온 것인지와 의존하는 문서를 알려 준다", () => {
    const add = (title: string) => (text: string) => text.replace("# 끝", `### [CLI-003] ${title}\n\n${title}한다.\n\n# 끝`);

    git("checkout", "-b", "a");
    edit(add("점검"));
    docRevise(repo, "prd", undefined, { ...today, grades: { "CLI-003": "minor" } });
    docNew(repo, "spec", "login", today);
    fs.writeFileSync(docPath(repo, "checklist", "login"), fs.readFileSync(docPath(repo, "checklist", "login"), "utf8").replace("- [ ]", "- [x]"));
    docChecklist(repo, "login");
    docComplete(repo, "spec", "login", { ...today, depends: ["CLI-003"] });
    commit("a");

    git("checkout", "-b", "b", "base");
    edit(add("제거"));
    docRevise(repo, "prd", undefined, { ...today, grades: { "CLI-003": "minor" } });
    commit("b");

    git("checkout", "a");
    git("merge", "b");
    // 본문의 충돌은 사람이 푼다. 두 항목을 모두 남긴다.
    edit((text) => text.replace(/<<<<<<< .*\n/, "").replace(/=======\n/, "").replace(/>>>>>>> .*\n/, ""));
    docRestore(repo, "prd", undefined);

    const [duplicate] = docChanges(repo, "prd", undefined).duplicates;
    expect(duplicate).toMatchObject({ id: "CLI-003", original: 1, dependents: ["docs/specs/login/spec.md"] });
    expect(duplicate?.headings).toEqual(["### [CLI-003] 점검", "### [CLI-003] 제거"]);
    expect(check(repo).problems.map((problem) => problem.message).join("\n")).toContain("docs/specs/login/spec.md");
    expect(() => docRevise(repo, "prd", undefined, { ...today, grades: { "CLI-003": "minor" } })).toThrow(/중복/);

    edit((text) => text.replace("### [CLI-003] 제거", "### [CLI-004] 제거"));
    const changes = docChanges(repo, "prd", undefined);
    expect(changes).toMatchObject({ added: ["CLI-004"], changed: [], duplicates: [] });
    expect(docRevise(repo, "prd", undefined, { ...today, grades: { "CLI-004": "minor" } }).version).toBe("1.2.0");
    // spec은 원래 있던 CLI-003을 뜻했으므로 그대로다.
    expect(docConfirm(repo, "spec", "login", {}).updated).toEqual(["prd"]);
  });
});
