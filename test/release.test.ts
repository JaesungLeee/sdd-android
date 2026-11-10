import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { changelogEntry, changelogVersions, releaseProblems } from "../scripts/release-check.mjs";
import { changelogBetween } from "../src/commands/upgrade.js";

const PROJECT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const REAL = fs.readFileSync(path.join(PROJECT, "CHANGELOG.md"), "utf8");

const LOG = "# Changelog\n\n## [0.2.0] - 2026-10-07\n\n### Added\n\n- 둘\n\n## [0.1.0] - 2026-10-04\n\n- 하나\n";

describe("릴리스 검사", () => {
  it("버전의 항목을 제목과 본문으로 나눈다", () => {
    expect(changelogVersions(LOG)).toEqual(["0.2.0", "0.1.0"]);
    expect(changelogEntry(LOG, "0.2.0")).toEqual({ heading: "## [0.2.0] - 2026-10-07", date: "2026-10-07", body: "### Added\n\n- 둘" });
    expect(changelogEntry(LOG, "0.1.0")?.body).toBe("- 하나");
    expect(changelogEntry(LOG, "0.3.0")).toBeNull();
    expect(changelogEntry("## 0.2.0\n\n- 둘\n", "0.2.0")?.date).toBeNull();
  });

  it("upgrade가 보여 주는 항목과 같은 범위를 자른다", () => {
    const versions = changelogVersions(REAL);
    for (const [i, version] of versions.entries()) {
      const previous = versions[i + 1] ?? "0.0.0";
      const entry = changelogEntry(REAL, version);
      expect(changelogBetween(REAL, previous, version)).toBe(`${entry?.heading}\n\n${entry?.body}`);
    }
  });

  it("배포할 수 있는 상태면 문제가 없다", () => {
    expect(releaseProblems({ version: "0.2.0", changelog: LOG })).toEqual([]);
    expect(releaseProblems({ version: "0.2.0", changelog: LOG, latest: "0.1.0" })).toEqual([]);
    // 저장소의 package.json 버전은 언제나 변경 내역에 항목이 있다
    const { version } = JSON.parse(fs.readFileSync(path.join(PROJECT, "package.json"), "utf8"));
    expect(releaseProblems({ version, changelog: REAL })).toEqual([]);
  });

  it("배포를 막는 문제를 알린다", () => {
    expect(releaseProblems({ version: "0.3.0", changelog: LOG })).toEqual([
      "CHANGELOG.md에 0.3.0 항목이 없다. 제목은 `## [0.3.0] - YYYY-MM-DD`다.",
    ]);
    expect(releaseProblems({ version: "0.1.0", changelog: LOG })).toEqual([
      "CHANGELOG.md의 맨 위 항목이 0.2.0다. 최신 버전인 0.1.0이 맨 위에 온다.",
    ]);
    expect(releaseProblems({ version: "0.2.0", changelog: LOG, latest: "0.2.0" })).toEqual([
      "0.2.0이 npm의 최신 버전(0.2.0)보다 높지 않다.",
    ]);
    expect(releaseProblems({ version: "0.2.0", changelog: "## [0.2.0]\n\n- 둘\n" })[0]).toContain("제목 형식이 다르다");
    expect(releaseProblems({ version: "0.2.0", changelog: "## [0.2.0] - 2026-10-07\n\n## [0.1.0] - 2026-10-04\n\n- 하나\n" })).toEqual([
      "0.2.0 항목이 비어 있다.",
    ]);
    expect(releaseProblems({ version: "0.6.0-rc.1", changelog: LOG })[0]).toContain("X.Y.Z 형식이 아니다");
  });
});
