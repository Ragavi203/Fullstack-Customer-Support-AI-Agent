import fs from "fs";
import path from "path";
import type { RetrievedChunk, Tier } from "../types";
import { chunkMarkdown, type PolicyChunk } from "./chunker";
import { cosine, embedOpenAI, localEmbed, sharesContentTerm, tokenize } from "./embeddings";

export interface SearchHit extends RetrievedChunk {}

export interface SearchResult {
  hits: SearchHit[];
  topScore: number;
  threshold: number;
  confident: boolean;
  provider: "openai" | "local";
  embeddingTokens: number;
  expandedQuery: boolean;
  reason: string;
}

interface IndexedChunk extends PolicyChunk {
  vector: number[];
  terms: Map<string, number>;
  length: number;
}

type IndexState = {
  provider: "openai" | "local";
  chunks: IndexedChunk[];
  warning: string | null;
  embeddingTokens: number;
  idf: Map<string, number>;
  avgLength: number;
};

export type RetrievalMode = "hybrid" | "vector" | "keyword";

const BM25_K1 = 1.2;
const BM25_B = 0.75;
// bm25 / (bm25 + BM25_SATURATION) maps raw BM25 into 0..1 without per-query normalization,
// so the fused score stays comparable across queries and can carry a fixed threshold.
const BM25_SATURATION = 6;
const VECTOR_WEIGHT = 0.6;

function chunkTerms(chunk: PolicyChunk): string[] {
  return tokenize(`${chunk.title} ${chunk.section} ${chunk.section} ${chunk.text}`);
}

function withLexicalStats(chunks: Array<PolicyChunk & { vector: number[] }>): Pick<IndexState, "chunks" | "idf" | "avgLength"> {
  const indexed = chunks.map((chunk) => {
    const tokens = chunkTerms(chunk);
    const terms = new Map<string, number>();
    for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1);
    return { ...chunk, terms, length: tokens.length };
  });
  const df = new Map<string, number>();
  for (const chunk of indexed) for (const term of chunk.terms.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const n = indexed.length;
  const idf = new Map([...df].map(([term, count]) => [term, Math.log(1 + (n - count + 0.5) / (count + 0.5))]));
  const avgLength = indexed.reduce((sum, chunk) => sum + chunk.length, 0) / Math.max(1, n);
  return { chunks: indexed, idf, avgLength };
}

function bm25(queryTerms: string[], chunk: IndexedChunk, index: IndexState): number {
  let score = 0;
  for (const term of new Set(queryTerms)) {
    const tf = chunk.terms.get(term);
    if (!tf) continue;
    const idf = index.idf.get(term) ?? 0;
    score += (idf * tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + (BM25_B * chunk.length) / index.avgLength));
  }
  return score;
}

export function retrievalMode(): RetrievalMode {
  const raw = process.env.RAG_MODE;
  return raw === "vector" || raw === "keyword" ? raw : "hybrid";
}

type StoreGlobal = typeof globalThis & { __lindenIndex?: IndexState };

function policiesDir(): string {
  return path.join(process.cwd(), "data", "policies");
}

export function loadPolicyChunks(): PolicyChunk[] {
  const dir = policiesDir();
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".md")).sort();
  return files.flatMap((file) => {
    const markdown = fs.readFileSync(path.join(dir, file), "utf8");
    return chunkMarkdown(file.replace(/\.md$/, ""), markdown);
  });
}

export function confidenceThreshold(provider: "openai" | "local", mode: RetrievalMode = retrievalMode()): number {
  const raw = process.env.RAG_CONFIDENCE_THRESHOLD;
  if (raw && !Number.isNaN(Number(raw))) return Number(raw);
  return THRESHOLDS[provider][mode];
}

// Local values are calibrated on evals/retrieval-set.ts (see README). OpenAI values are starting points.
const THRESHOLDS: Record<"openai" | "local", Record<RetrievalMode, number>> = {
  local: { vector: 0.2, keyword: 0.3, hybrid: 0.26 },
  openai: { vector: 0.42, keyword: 0.3, hybrid: 0.38 },
};

async function buildIndex(): Promise<IndexState> {
  const chunks = loadPolicyChunks();
  const inputs = chunks.map((chunk) => `${chunk.title}. ${chunk.section}. ${chunk.text}`);
  if (process.env.OPENAI_API_KEY) {
    try {
      const embedded = await embedOpenAI(inputs);
      return {
        provider: "openai",
        warning: null,
        embeddingTokens: embedded.tokens,
        ...withLexicalStats(chunks.map((chunk, i) => ({ ...chunk, vector: embedded.vectors[i] }))),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "embedding request failed";
      return {
        provider: "local",
        warning: message,
        embeddingTokens: 0,
        ...withLexicalStats(chunks.map((chunk, i) => ({ ...chunk, vector: localEmbed(inputs[i]) }))),
      };
    }
  }
  return {
    provider: "local",
    warning: null,
    embeddingTokens: 0,
    ...withLexicalStats(chunks.map((chunk, i) => ({ ...chunk, vector: localEmbed(inputs[i]) }))),
  };
}

export async function getIndex(): Promise<IndexState> {
  const g = globalThis as StoreGlobal;
  if (!g.__lindenIndex) g.__lindenIndex = await buildIndex();
  return g.__lindenIndex;
}

export function resetIndex(): void {
  const g = globalThis as StoreGlobal;
  delete g.__lindenIndex;
}

function namedTier(query: string): Tier | null {
  const text = query.toLowerCase();
  if (/\bbusiness\b/.test(text)) return "business";
  if (/\bplus\b/.test(text)) return "plus";
  if (/\bprepaid\b/.test(text)) return "prepaid";
  return null;
}

function tierAllows(chunk: PolicyChunk, tier: Tier | null): boolean {
  if (chunk.tiers.includes("all")) return true;
  if (!tier) return false;
  return chunk.tiers.includes(tier);
}

export async function searchKnowledge(
  query: string,
  tier: Tier | null,
  opts?: { k?: number; expanded?: boolean; access?: "strict" | "open"; mode?: RetrievalMode },
): Promise<SearchResult> {
  const index = await getIndex();
  const embedded = await embedQuery(query, index.provider);
  const provider = embedded.provider;
  const mode = opts?.mode ?? retrievalMode();
  const threshold = confidenceThreshold(provider, mode);
  const access = opts?.access ?? "open";
  const queryTerms = tokenize(query);

  const focus = namedTier(query) ?? tier;
  const ranked = index.chunks
    .map((chunk) => {
      const vector = cosine(embedded.vector, chunk.vector);
      const raw = bm25(queryTerms, chunk, index);
      const keyword = raw / (raw + BM25_SATURATION);
      let score = mode === "vector" ? vector : mode === "keyword" ? keyword : VECTOR_WEIGHT * vector + (1 - VECTOR_WEIGHT) * keyword;
      if (access === "open" && focus && !chunk.tiers.includes("all")) {
        score = chunk.tiers.includes(focus) ? Math.min(1, score * 1.08) : score * 0.9;
      }
      return { chunk, score };
    })
    .sort((a, b) => b.score - a.score);

  const visible = access === "strict" ? ranked.filter((row) => tierAllows(row.chunk, tier)) : ranked;
  const k = opts?.k ?? 4;
  const hits: SearchHit[] = visible.slice(0, k).map((row) => ({
    id: row.chunk.id,
    docId: row.chunk.docId,
    title: row.chunk.title,
    section: row.chunk.section,
    text: row.chunk.text,
    score: round(row.score),
    tiers: row.chunk.tiers,
  }));

  const top = hits[0];
  const topScore = top?.score ?? 0;
  const lexical = top ? sharesContentTerm(query, `${top.title} ${top.section} ${top.text}`) : false;
  let confident = Boolean(top) && topScore >= threshold;
  let reason = confident
    ? `Top match ${topScore.toFixed(2)} is at or above ${threshold.toFixed(2)}.`
    : `Top match ${topScore.toFixed(2)} is below ${threshold.toFixed(2)}.`;

  if (confident && provider === "local" && !lexical) {
    confident = false;
    reason = `Similarity ${topScore.toFixed(2)} cleared the cutoff but shared no content terms, so it was rejected.`;
  }
  const bestOverall = ranked[0]?.chunk;
  if (access === "strict" && bestOverall && !tierAllows(bestOverall, tier)) {
    confident = false;
    reason = `The closest guide, “${bestOverall.section}”, is published for ${bestOverall.tiers.join(" and ")} plans only.`;
  }
  if (access === "strict" && !visible.length) {
    confident = false;
    reason = "No troubleshooting guide is published for this tier.";
  }

  return {
    hits,
    topScore,
    threshold,
    confident,
    provider,
    embeddingTokens: embedded.tokens,
    expandedQuery: Boolean(opts?.expanded),
    reason,
  };
}

async function embedQuery(
  query: string,
  indexProvider: "openai" | "local",
): Promise<{ vector: number[]; tokens: number; provider: "openai" | "local" }> {
  if (indexProvider === "local") {
    return { vector: localEmbed(query), tokens: 0, provider: "local" };
  }
  const embedded = await embedOpenAI([query]);
  return { vector: embedded.vectors[0], tokens: embedded.tokens, provider: "openai" };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export async function indexStats(): Promise<{ chunks: number; provider: string; warning: string | null }> {
  const index = await getIndex();
  return { chunks: index.chunks.length, provider: index.provider, warning: index.warning };
}
