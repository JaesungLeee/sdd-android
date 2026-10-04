export interface NormalizeOptions {
  /** breakdown의 체크 표시를 빈 것으로 바꾼다. 체크 상태는 해시에 넣지 않는다. */
  uncheck?: boolean;
}

/**
 * 해시 전의 정규화. 줄 안의 공백과 빈 줄의 수는 손대지 않는다.
 * 마크다운에서 뜻이 달라질 수 있기 때문이다(코드 블록, 들여쓰기).
 */
export function normalizeText(text: string, options: NormalizeOptions = {}): string {
  let lines = text
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""));
  if (options.uncheck) {
    lines = lines.map((line) => line.replace(/^(\s*[-*] )\[[xX]\]/, "$1[ ]"));
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
