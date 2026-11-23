import fs from "fs";
import path from "path";
import { CASES, type EvalCase } from "./cases";
import { RETRIEVAL_SET } from "./retrieval-set";
import type { Decision, Intent, TurnTrace } from "../lib/types";

const live = process.argv.includes("--live");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);

if (live) {
  for (const file of [".env.local", ".env"]) {
    if (fs.existsSync(file)) process.loadEnvFile(file);
  }
  if (!process.env.XAI_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error("--live needs XAI_API_KEY or OPENAI_API_KEY in the environment or .env.local");
    process.exit(1);
  }
} else {
  delete process.env.XAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
}

// Imported after the environment is settled so provider selection sees the right keys.
const { runTurn } = await import("../lib/agent/orchestrator");
const { resetDemoData, findCustomerByEmail } = await import("../lib/data/customers");
const { createSession } = await import("../lib/session/store");
const { searchKnowledge, retrievalMode, confidenceThreshold } = await import("../lib/rag/store");
type RetrievalMode = import("../lib/rag/store").RetrievalMode;
const { activeProvider } = await import("../lib/llm/provider");

type CheckName = "intent" | "tools" | "retrieval" | "decision" | "reply" | "sideEffects";

interface CaseResult {
  id: string;
  tags: string[];
  passed: boolean;
  checks: Partial<Record<CheckName, boolean>>;
  failures: string[];
  intent: Intent;
  decision: Decision;
  tools: string[];
  topSection: string | null;
  searchQuery: string | null;
  rewritten: boolean;
  violations: string[];
  reply: string;
  e2eMs: number;
  costUsd: number;
  tokens: number;
}

async function runCase(item: EvalCase): Promise<CaseResult> {
  resetDemoData();
  const session = createSession(item.caller);
  const turn = async (text: string) => {
    const events: { event: string; data: unknown }[] = [];
    await runTurn({
      session,
      text,
      mode: "chat",
      profileEmail: item.caller,
      toolPaceMs: 0,
      tokenPaceMs: 0,
      emit: (event, data) => events.push({ event, data }),
    });
    const trace = events.find((e) => e.event === "trace")?.data as TurnTrace;
    const replaced = [...events].reverse().find((e) => e.event === "replace")?.data as { text: string } | undefined;
    const streamed = events.filter((e) => e.event === "token").map((e) => (e.data as { text: string }).text).join("");
    return { trace, reply: replaced?.text ?? streamed };
  };
  for (const prior of item.history ?? []) await turn(prior);
  const { trace, reply } = await turn(item.text);

  const checks: CaseResult["checks"] = {};
  const failures: string[] = [];
  const check = (name: CheckName, ok: boolean, detail: string) => {
    checks[name] = (checks[name] ?? true) && ok;
    if (!ok) failures.push(`${name}: ${detail}`);
  };
  const tools = trace.steps.map((step) => step.tool);
  const top = trace.retrieval?.hits[0];
  const topSection = top ? `${top.title} · ${top.section}` : null;
  const expect = item.expect;
  const oneOf = <T,>(value: T, allowed: T | T[]) => (Array.isArray(allowed) ? allowed.includes(value) : value === allowed);

  if (expect.intent) check("intent", oneOf(trace.intent, expect.intent), `got ${trace.intent}, want ${expect.intent}`);
  if (expect.tools) check("tools", tools.join(">") === expect.tools.join(">"), `got [${tools.join(", ")}]`);
  const context = (trace.retrieval?.hits ?? []).slice(0, 3).map((hit) => `${hit.title} · ${hit.section}`);
  if (expect.section) check("retrieval", context.includes(expect.section), `not in the top 3 given to the model: ${context.join(" | ") || "none"}`);
  if (expect.decision) check("decision", oneOf(trace.guardrail.decision, expect.decision), `got ${trace.guardrail.decision}, want ${expect.decision}`);
  for (const pattern of expect.replyIncludes ?? []) check("reply", pattern.test(reply), `missing ${pattern}`);
  for (const pattern of expect.replyExcludes ?? []) check("reply", !pattern.test(reply), `contains ${pattern}`);
  if (expect.refunds !== undefined && item.caller) {
    const count = findCustomerByEmail(item.caller)?.refunds.length ?? 0;
    check("sideEffects", count === expect.refunds, `refunds ${count}, want ${expect.refunds}`);
  }
  if (expect.untouched) {
    const count = findCustomerByEmail(expect.untouched)?.refunds.length ?? 0;
    check("sideEffects", count === 0, `${expect.untouched} has ${count} refunds`);
  }
  if (expect.billingEmail && item.caller) {
    const current = findCustomerByEmail(item.caller)?.billingEmail;
    check("sideEffects", current === expect.billingEmail, `billing email is ${current}`);
  }

  return {
    id: item.id,
    tags: item.tags,
    passed: failures.length === 0,
    checks,
    failures,
    intent: trace.intent,
    decision: trace.guardrail.decision,
    tools,
    topSection,
    searchQuery: trace.retrieval?.query ?? null,
    rewritten: trace.guardrail.rewritten,
    violations: trace.guardrail.violations,
    reply,
    e2eMs: trace.e2eMs,
    costUsd: trace.costUsd,
    tokens: trace.usage.promptTokens + trace.usage.completionTokens,
  };
}

interface RetrievalRow {
  query: string;
  expect: string | null;
  ranked: string[];
  rank: number | null;
  confident: boolean;
  topScore: number;
}

async function runRetrieval(mode: RetrievalMode): Promise<RetrievalRow[]> {
  const rows: RetrievalRow[] = [];
  for (const item of RETRIEVAL_SET) {
    const result = await searchKnowledge(item.query, item.tier, { access: item.access ?? "open", k: 5, mode });
    const ranked = result.hits.map((hit) => `${hit.title} · ${hit.section}`);
    const index = item.expect ? ranked.indexOf(item.expect) : -1;
    rows.push({
      query: item.query,
      expect: item.expect,
      ranked,
      rank: index >= 0 ? index + 1 : null,
      confident: result.confident,
      topScore: result.topScore,
    });
  }
  return rows;
}

function pct(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(1)}%` : "n/a";
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summarize(rows: RetrievalRow[]) {
  const answerable = rows.filter((row) => row.expect);
  const unanswerable = rows.filter((row) => !row.expect);
  return {
    answerable,
    unanswerable,
    hit1: answerable.filter((row) => row.rank === 1).length,
    hit3: answerable.filter((row) => row.rank !== null && row.rank <= 3).length,
    mrr: answerable.reduce((sum, row) => sum + (row.rank ? 1 / row.rank : 0), 0) / answerable.length,
    answeredCorrectly: answerable.filter((row) => row.rank === 1 && row.confident).length,
    falseConfident: unanswerable.filter((row) => row.confident).length,
  };
}

const activeMode = retrievalMode();
const ablation = await Promise.all(
  (["vector", "keyword", "hybrid"] as RetrievalMode[]).map(async (mode) => ({ mode, ...summarize(await runRetrieval(mode)) })),
);
const retrieval = await runRetrieval(activeMode);
const { answerable, unanswerable, hit1, hit3, mrr, answeredCorrectly, falseConfident } = summarize(retrieval);
const sweep = Array.from({ length: 16 }, (_, i) => 0.1 + i * 0.02).map((threshold) => ({
  threshold,
  covered: answerable.filter((row) => row.rank === 1 && row.topScore >= threshold).length,
  wrongButConfident: answerable.filter((row) => row.rank !== 1 && row.topScore >= threshold).length,
  rejected: unanswerable.filter((row) => row.topScore < threshold).length,
}));

const cases = only ? CASES.filter((item) => item.id.includes(only)) : CASES;
const results: CaseResult[] = [];
for (const item of cases) {
  const result = await runCase(item);
  results.push(result);
  console.log(`${result.passed ? "PASS" : "FAIL"}  ${item.id}${result.failures.length ? `  (${result.failures.join("; ")})` : ""}`);
}

const checkNames: CheckName[] = ["intent", "tools", "retrieval", "decision", "reply", "sideEffects"];
const checkRows = checkNames.map((name) => {
  const scored = results.filter((r) => r.checks[name] !== undefined);
  const ok = scored.filter((r) => r.checks[name]).length;
  return { name, ok, total: scored.length };
});
const safety = results.filter((r) => r.tags.includes("safety"));
const latencies = results.map((r) => r.e2eMs);
const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);
const provider = activeProvider();
const label = live && provider ? `live · ${provider.label} ${provider.model}` : "deterministic (no model key)";
const passed = results.filter((r) => r.passed).length;

const lines: string[] = [];
lines.push(`# Eval report: ${label}`, "");
lines.push(`Generated ${new Date().toISOString()}. Run with \`npm run eval${live ? ":live" : ""}\`.`, "");
lines.push("## Retrieval", "");
lines.push(`${answerable.length} answerable queries and ${unanswerable.length} that no policy covers. Scores are for the first search pass, before query expansion.`, "");
lines.push("| Mode | Hit@1 | Hit@3 | MRR | Correct and confident | Unanswerable rejected |", "| --- | --- | --- | --- | --- | --- |");
for (const row of ablation) {
  lines.push(
    `| ${row.mode}${row.mode === activeMode ? " (active)" : ""} | ${pct(row.hit1, row.answerable.length)} | ${pct(row.hit3, row.answerable.length)} | ${row.mrr.toFixed(3)} | ${pct(row.answeredCorrectly, row.answerable.length)} | ${pct(row.unanswerable.length - row.falseConfident, row.unanswerable.length)} |`,
  );
}
lines.push("");
lines.push(`Threshold sweep for ${activeMode} (current ${confidenceThreshold(process.env.OPENAI_API_KEY ? "openai" : "local", activeMode).toFixed(2)} unless overridden):`, "");
lines.push("| Threshold | Correct top hit and confident | Wrong top hit but confident | Unanswerable rejected |", "| --- | --- | --- | --- |");
for (const row of sweep) {
  lines.push(`| ${row.threshold.toFixed(2)} | ${row.covered}/${answerable.length} | ${row.wrongButConfident} | ${row.rejected}/${unanswerable.length} |`);
}
lines.push("", `Active mode, ${activeMode}:`, "");
lines.push("| Metric | Value |", "| --- | --- |");
lines.push(`| Hit@1 | ${pct(hit1, answerable.length)} (${hit1}/${answerable.length}) |`);
lines.push(`| Hit@3 | ${pct(hit3, answerable.length)} (${hit3}/${answerable.length}) |`);
lines.push(`| MRR | ${mrr.toFixed(3)} |`);
lines.push(`| Correct and confident | ${pct(answeredCorrectly, answerable.length)} |`);
lines.push(`| Unanswerable rejected by the threshold | ${pct(unanswerable.length - falseConfident, unanswerable.length)} (${unanswerable.length - falseConfident}/${unanswerable.length}) |`, "");
const misses = retrieval.filter((row) => (row.expect ? row.rank !== 1 : row.confident));
if (misses.length) {
  lines.push("Misses:", "");
  for (const row of misses) {
    lines.push(`- "${row.query}": want ${row.expect ?? "no confident hit"}, got ${row.ranked[0] ?? "nothing"} (${row.topScore.toFixed(2)}${row.confident ? ", confident" : ""})`);
  }
  lines.push("");
}
lines.push("## End to end", "");
lines.push(`${passed}/${results.length} cases pass (${pct(passed, results.length)}). Safety cases: ${safety.filter((r) => r.passed).length}/${safety.length}.`, "");
lines.push("| Check | Pass rate |", "| --- | --- |");
for (const row of checkRows) lines.push(`| ${row.name} | ${pct(row.ok, row.total)} (${row.ok}/${row.total}) |`);
lines.push("");
lines.push(`Latency p50 ${percentile(latencies, 50)} ms, p95 ${percentile(latencies, 95)} ms. Estimated cost $${totalCost.toFixed(4)} total, $${(totalCost / Math.max(1, results.length)).toFixed(5)} per turn.`, "");
const rewrites = results.filter((r) => r.rewritten);
lines.push(`The grounding check replaced ${rewrites.length} of ${results.length} model replies with the tool-grounded draft.`, "");
for (const r of rewrites) lines.push(`- \`${r.id}\`: ${r.violations.join(" ")}`);
if (rewrites.length) lines.push("");
const failed = results.filter((r) => !r.passed);
if (failed.length) {
  lines.push("Failures:", "");
  for (const r of failed) lines.push(`- \`${r.id}\`: ${r.failures.join("; ")}`);
  lines.push("");
}

const outDir = path.join("evals", "results");
fs.mkdirSync(outDir, { recursive: true });
const name = live ? "live" : "deterministic";
fs.writeFileSync(path.join(outDir, `${name}.md`), lines.join("\n"));
fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ label, retrieval, results }, null, 2));
console.log(`\n${lines.join("\n")}`);
console.log(`Wrote ${path.join(outDir, `${name}.md`)}`);
