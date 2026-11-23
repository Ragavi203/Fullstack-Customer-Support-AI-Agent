export interface PolicyChunk {
  id: string;
  docId: string;
  title: string;
  section: string;
  text: string;
  tiers: string[];
}

const TIER_LINE = /^Tiers:\s*(.+)$/i;

function parseTiers(line: string | undefined): string[] {
  if (!line) return ["all"];
  const match = line.match(TIER_LINE);
  if (!match) return ["all"];
  const tiers = match[1]
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return tiers.length ? tiers : ["all"];
}

function windowText(section: string, text: string, maxChars: number, overlap: number): string[] {
  const clean = text.replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= maxChars) return [clean];
  const parts: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + maxChars);
    if (end < clean.length) {
      const breakAt = clean.lastIndexOf("\n\n", end);
      if (breakAt > start + maxChars * 0.5) end = breakAt;
    }
    const slice = clean.slice(start, end).trim();
    if (slice) parts.push(slice);
    if (end >= clean.length) break;
    start = Math.max(0, end - overlap);
  }
  return parts;
}

export function chunkMarkdown(
  docId: string,
  markdown: string,
  opts?: { maxChars?: number; overlap?: number; includePreamble?: boolean },
): PolicyChunk[] {
  const maxChars = opts?.maxChars ?? 700;
  const overlap = opts?.overlap ?? 120;
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let title = docId;
  const sections: { section: string; body: string[] }[] = [];
  // Text above the first "##" is an authoring note for the agent, not customer-facing policy,
  // so it is left out of the index unless asked for.
  let current = { section: opts?.includePreamble ? "Overview" : "", body: [] as string[] };

  for (const line of lines) {
    if (line.startsWith("# ")) {
      title = line.slice(2).trim() || title;
      continue;
    }
    if (line.startsWith("## ")) {
      if (current.section && current.body.some((l) => l.trim())) sections.push(current);
      current = { section: line.slice(3).trim() || "Section", body: [] };
      continue;
    }
    current.body.push(line);
  }
  if (current.section && current.body.some((l) => l.trim())) sections.push(current);

  const chunks: PolicyChunk[] = [];
  for (const section of sections) {
    const raw = section.body.join("\n").trim();
    const rawLines = raw.split("\n");
    const tiers = parseTiers(rawLines.find((l) => TIER_LINE.test(l.trim())));
    const withoutMeta = rawLines.filter((l) => !TIER_LINE.test(l.trim())).join("\n").trim();
    const windows = windowText(section.section, withoutMeta, maxChars, overlap);
    windows.forEach((text, index) => {
      const suffix = windows.length > 1 ? `:${index + 1}` : "";
      chunks.push({
        id: `${docId}:${slug(section.section)}${suffix}`,
        docId,
        title,
        section: section.section,
        text,
        tiers,
      });
    });
  }
  return chunks;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
