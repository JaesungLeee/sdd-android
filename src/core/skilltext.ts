const SKILL_REF = /\{\{skill:([a-z0-9][a-z0-9-]*)\}\}/g;

/** 접두사를 붙인 스킬 이름. 접두사가 없으면 이름 그대로다. */
export function skillName(name: string, prefix: string): string {
  return prefix ? `${prefix}-${name}` : name;
}

/**
 * 스킬 참조 표기 `{{skill:spec}}`를 접두사를 붙인 스킬 이름으로 바꾼다. 설치할 때 한다.
 * 이름을 직접 찾아 바꾸지 않는 것은 `spec`, `prd` 같은 이름이 본문에 일반 명사로 나오기 때문이다.
 */
export function applyPrefix(text: string, prefix: string): string {
  return text.replace(SKILL_REF, (_, name: string) => skillName(name, prefix));
}

/** 스킬이 가리키는 다른 스킬의 이름. 언어 사이의 구조 검사에 쓴다. */
export function skillRefs(text: string): string[] {
  return [...text.matchAll(SKILL_REF)].map((match) => match[1] as string);
}
