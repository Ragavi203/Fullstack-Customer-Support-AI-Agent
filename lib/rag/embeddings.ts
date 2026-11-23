const DIM = 1024;

const STOP = new Set([
  "the", "a", "an", "to", "for", "my", "i", "me", "is", "of", "and", "on", "in",
  "it", "you", "we", "our", "your", "with", "that", "this", "was", "are", "be",
  "can", "get", "please", "what", "whats", "how", "do", "does", "did", "a",
  "about", "from", "at", "or", "if", "im", "ive", "its",
]);

export function stem(token: string): string {
  let word = token;
  if (word.length > 4 && word.endsWith("ies")) word = `${word.slice(0, -3)}y`;
  else if (word.length > 4 && /(ss|x|z|ch|sh)es$/.test(word)) word = word.slice(0, -2);
  else if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) word = word.slice(0, -1);

  if (word.length > 5 && word.endsWith("ing")) word = word.slice(0, -3);
  else if (word.length > 4 && word.endsWith("ed")) word = word.slice(0, -2);
  else return word.length > 4 && word.endsWith("e") ? word.slice(0, -1) : word;

  // "dropp" -> "drop", but keep "bill", "call", "pass".
  if (/([bdgmnprt])\1$/.test(word)) word = word.slice(0, -1);
  return word.length > 4 && word.endsWith("e") ? word.slice(0, -1) : word;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP.has(token))
    .map(stem);
}

function fnv(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function localEmbed(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  const tokens = tokenize(text);
  const grams = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) grams.push(`${tokens[i]}_${tokens[i + 1]}`);
  const counts = new Map<string, number>();
  for (const gram of grams) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  for (const [gram, count] of counts) {
    const weight = 1 + Math.log(count);
    const hash = fnv(gram);
    const sign = hash & 1 ? 1 : -1;
    vec[hash % DIM] += sign * weight;
    vec[(hash >>> 10) % DIM] += sign * weight * 0.5;
  }
  let norm = 0;
  for (const n of vec) norm += n * n;
  norm = Math.sqrt(norm) || 1;
  return vec.map((n) => n / norm);
}

export function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function sharesContentTerm(query: string, text: string): boolean {
  const terms = new Set(tokenize(query).filter((token) => token.length > 3));
  if (!terms.size) return false;
  const doc = new Set(tokenize(text));
  for (const term of terms) {
    if (doc.has(term)) return true;
  }
  return false;
}

export async function embedOpenAI(texts: string[]): Promise<{ vectors: number[][]; tokens: number }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Embeddings failed (${res.status}): ${detail.slice(0, 180)}`);
  }
  const json = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
    usage?: { total_tokens?: number };
  };
  const vectors = json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((row) => row.embedding);
  return { vectors, tokens: json.usage?.total_tokens ?? 0 };
}
