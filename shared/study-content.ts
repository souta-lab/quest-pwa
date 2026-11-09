export type ContentBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "code"; text: string };
function cells(line: string) {
  const result: string[] = [],
    chars = [...line.trim()];
  let cell = "",
    math = false;
  for (let n = 0; n < chars.length; n++) {
    const c = chars[n];
    if (c === "$" && chars[n - 1] !== "\\") math = !math;
    if (c === "|" && !math && chars[n - 1] !== "\\") {
      result.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  result.push(cell.trim());
  if (!result[0]) result.shift();
  if (!result.at(-1)) result.pop();
  return result;
}
// Strict structural parsing only. Model-provided HTML, URLs and script are text.
export function studyContent(text: string): ContentBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n"),
    blocks: ContentBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i]))
        code.push(lines[i]);
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const header = line.includes("|") ? cells(line) : [],
      separator = cells(lines[i + 1] ?? "");
    if (
      header.length >= 2 &&
      header.length <= 12 &&
      header.length === separator.length &&
      separator.every((s) => /^:?-{3,}:?$/.test(s))
    ) {
      let end = i + 2;
      const rows: string[][] = [];
      while (
        end < lines.length &&
        lines[end].trim() &&
        lines[end].includes("|")
      ) {
        rows.push(cells(lines[end]));
        end++;
      }
      if (rows.length && rows.every((r) => r.length === header.length)) {
        flush();
        blocks.push({ kind: "table", header, rows });
        i = end - 1;
        continue;
      }
    }
    if (!line.trim()) flush();
    else paragraph.push(line);
  }
  flush();
  return blocks;
}
