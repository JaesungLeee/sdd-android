export type Grade = "major" | "minor" | "patch";

const GRADE_ORDER: Record<Grade, number> = { patch: 1, minor: 2, major: 3 };

export function isGrade(value: unknown): value is Grade {
  return value === "major" || value === "minor" || value === "patch";
}

export function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`버전 형식이 아니다: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function bumpVersion(version: string, grade: Grade): string {
  const [major, minor, patch] = parseVersion(version);
  if (grade === "major") return `${major + 1}.0.0`;
  if (grade === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** 개정 기록이 없는 문서(spec, blueprint)의 뒤처짐 등급을 버전 번호의 차이로 낸다. */
export function gradeBetween(from: string, to: string): Grade | null {
  const a = parseVersion(from);
  const b = parseVersion(to);
  if (a[0] !== b[0]) return "major";
  if (a[1] !== b[1]) return "minor";
  if (a[2] !== b[2]) return "patch";
  return null;
}

export function maxGrade(grades: Iterable<Grade>): Grade | null {
  let max: Grade | null = null;
  for (const grade of grades) {
    if (max === null || GRADE_ORDER[grade] > GRADE_ORDER[max]) max = grade;
  }
  return max;
}

export function gradeAtLeast(grade: Grade, floor: Grade): boolean {
  return GRADE_ORDER[grade] >= GRADE_ORDER[floor];
}
