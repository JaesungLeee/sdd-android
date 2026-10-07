export const ITEM_ID_PATTERN = /^[A-Z]{1,5}-\d{3}$/;

const HEADING = /^(#{1,6})\s+(.*)$/;
const ITEM_HEADING = /^\[([A-Z]{1,5}-\d{3})\]/;
const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

export interface ItemSplit {
  /** 항목 ID에서 그 항목의 본문(제목 줄 포함)으로. */
  items: Map<string, string>;
  /** 어느 항목에도 속하지 않는 부분. */
  outside: string;
  /** 두 번 이상 나온 항목 ID. */
  duplicates: string[];
  /** 두 번 이상 나온 항목 ID에서, 문서에 나온 순서대로의 본문. 병합으로 번호가 겹쳤을 때 어느 쪽이 들어온 것인지 가리는 데 쓴다. */
  occurrences: Map<string, string[]>;
}

/**
 * 본문을 항목과 항목 밖으로 나눈다.
 * 항목은 `### [CLI-001] 이름` 같은 제목부터 같은 수준이거나 더 높은 수준의 다음 제목 전까지다.
 * 코드 블록 안의 제목은 제목으로 보지 않는다.
 * 항목 끝의 구분선(`---`)은 항목 밖으로 친다. 장의 마지막 항목 뒤에 새 항목을 더해도
 * 앞 항목이 바뀐 것으로 계산되지 않게 하기 위해서다.
 */
export function splitItems(body: string): ItemSplit {
  const items = new Map<string, string[]>();
  const all = new Map<string, string[][]>();
  const outside: string[] = [];
  const duplicates = new Set<string>();

  let current: { id: string; level: number; lines: string[] } | null = null;
  let fence: string | null = null;

  const close = () => {
    if (!current) return;
    const { lines } = current;
    const rules: string[] = [];
    while (lines.length > 0 && (lines[lines.length - 1] === "" || RULE.test(lines[lines.length - 1] ?? ""))) {
      const line = lines.pop() as string;
      if (line !== "") rules.unshift(line);
    }
    outside.push(...rules);
    current = null;
  };

  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1] ?? null;
      else if (fence === fenceMatch[1]) fence = null;
    }

    const heading = fence === null && !fenceMatch ? HEADING.exec(line) : null;
    if (heading) {
      const level = (heading[1] ?? "").length;
      if (current && level <= current.level) close();
      const item = ITEM_HEADING.exec(heading[2] ?? "");
      if (item && !current) {
        const id = item[1] as string;
        if (items.has(id)) duplicates.add(id);
        current = { id, level, lines: [] };
        items.set(id, current.lines);
        all.set(id, [...(all.get(id) ?? []), current.lines]);
      }
    }

    (current ? current.lines : outside).push(line);
  }
  close();

  return {
    items: new Map([...items].map(([id, lines]) => [id, lines.join("\n")])),
    outside: outside.join("\n"),
    duplicates: [...duplicates].sort(),
    occurrences: new Map(
      [...all].filter(([, list]) => list.length > 1).map(([id, list]) => [id, list.map((lines) => lines.join("\n"))]),
    ),
  };
}
