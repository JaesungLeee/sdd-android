export function composeSkill(source: string, fragments: Record<string, string>): string;
export function includedFragments(source: string): string[];
export function compareLanguages(
  structures: Record<
    string,
    { fragments: Record<string, string>; skills: Record<string, { includes: string[]; refs: string[] }> }
  >,
): string[];
export function buildAssets(outDir: string): Record<string, string>;
export function readText(file: string): string;
