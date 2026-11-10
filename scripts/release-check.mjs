// 릴리스 검사: package.json의 버전과 CHANGELOG.md의 항목이 배포할 수 있는 상태인지 본다. CI가 부른다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERSION = /^\d+\.\d+\.\d+$/;
/** upgrade(`changelogBetween`)가 항목을 나누는 제목과 같은 식이다. 다르면 upgrade가 못 읽는 항목이 통과한다. */
const HEADING = /^## \[?(\d+\.\d+\.\d+)\]?/;

export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** 변경 내역에 적힌 버전. 위에서부터의 순서다. */
export function changelogVersions(changelog) {
  return changelog
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => HEADING.exec(line)?.[1])
    .filter((version) => version !== undefined);
}

/** 그 버전의 항목. 제목 줄, 제목의 날짜(형식이 맞을 때만), 제목 아래 본문이다. */
export function changelogEntry(changelog, version) {
  let entry = null;
  for (const line of changelog.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      if (entry) break;
      if (heading[1] !== version) continue;
      const date = /^## \[\d+\.\d+\.\d+\] - (\d{4}-\d{2}-\d{2})$/.exec(line);
      entry = { heading: line, date: date ? date[1] : null, lines: [] };
    } else if (entry) {
      entry.lines.push(line);
    }
  }
  if (!entry) return null;
  return { heading: entry.heading, date: entry.date, body: entry.lines.join("\n").trim() };
}

/** 배포를 막는 문제. `latest`는 npm에 올라 있는 최신 버전이고, 새로 올릴 때만 넘긴다. */
export function releaseProblems({ version, changelog, latest }) {
  if (!VERSION.test(version)) {
    return [`package.json의 버전이 X.Y.Z 형식이 아니다: ${version}. upgrade가 이 형식만 읽는다.`];
  }
  const problems = [];
  const entry = changelogEntry(changelog, version);
  if (!entry) {
    problems.push(`CHANGELOG.md에 ${version} 항목이 없다. 제목은 \`## [${version}] - YYYY-MM-DD\`다.`);
  } else {
    if (!entry.date) problems.push(`${version} 항목의 제목 형식이 다르다: ${entry.heading}. \`## [${version}] - YYYY-MM-DD\`로 쓴다.`);
    if (!entry.body) problems.push(`${version} 항목이 비어 있다.`);
    const [first] = changelogVersions(changelog);
    if (first !== version) problems.push(`CHANGELOG.md의 맨 위 항목이 ${first}다. 최신 버전인 ${version}이 맨 위에 온다.`);
  }
  if (latest && VERSION.test(latest) && compareVersions(version, latest) <= 0) {
    problems.push(`${version}이 npm의 최신 버전(${latest})보다 높지 않다.`);
  }
  return problems;
}

function main() {
  const { values } = parseArgs({ options: { latest: { type: "string" }, notes: { type: "string" } } });
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  const problems = releaseProblems({ version, changelog, latest: values.latest });
  if (problems.length > 0) {
    console.error(`${version}은 배포할 수 없다:\n- ${problems.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  // GitHub Release의 본문으로 쓴다.
  if (values.notes) fs.writeFileSync(values.notes, `${changelogEntry(changelog, version).body}\n`);
  console.log(`${version}: 배포할 수 있다`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
