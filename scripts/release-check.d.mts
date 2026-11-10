export function compareVersions(a: string, b: string): number;
export function changelogVersions(changelog: string): string[];
export function changelogEntry(
  changelog: string,
  version: string,
): { heading: string; date: string | null; body: string } | null;
export function releaseProblems(options: { version: string; changelog: string; latest?: string }): string[];
