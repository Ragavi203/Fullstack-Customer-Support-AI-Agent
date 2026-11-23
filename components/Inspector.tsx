"use client";

import { useState } from "react";
import type { TurnTrace } from "@/lib/types";
import { DECISION, INTENT, cost, ms, shortModel } from "./format";
import { CheckIcon, CloseIcon, CopyIcon, CrossIcon } from "./Icons";

type Tab = "overview" | "tools" | "retrieval" | "prompt";

const IDENTITY = {
  session: "Signed-in caller",
  claimed: "Email only, read-only",
  none: "No account",
} as const;

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "tools", label: "Tools" },
  { id: "retrieval", label: "Retrieval" },
  { id: "prompt", label: "Prompt" },
];

interface InspectorProps {
  open: boolean;
  traces: TurnTrace[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function Inspector({ open, traces, selectedId, onSelect, onClose }: InspectorProps) {
  const [tab, setTab] = useState<Tab>("overview");
  const [copied, setCopied] = useState(false);
  const trace = traces.find((item) => item.id === selectedId) ?? traces[traces.length - 1] ?? null;

  return (
    <>
      <div className={`scrim ${open ? "is-open" : ""}`} onClick={onClose} />
      <aside className={`inspector ${open ? "is-open" : ""}`} aria-label="Inspector" aria-hidden={!open}>
        <header className="inspector-head">
          <h2>Inspector</h2>
          {traces.length > 0 && (
            <select className="input input-sm" value={trace?.id} onChange={(event) => onSelect(event.target.value)} aria-label="Turn">
              {traces.map((item, i) => (
                <option key={item.id} value={item.id}>
                  Turn {i + 1} · {INTENT[item.intent]}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close inspector">
            <CloseIcon />
          </button>
        </header>

        {!trace ? (
          <div className="inspector-empty">
            <p>No turns yet.</p>
            <p className="muted">Each reply records its tool calls, retrieval scores, guardrail decision, latency, tokens, and estimated cost.</p>
          </div>
        ) : (
          <>
            <nav className="tabs" role="tablist">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  className={tab === item.id ? "is-active" : ""}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                  {item.id === "tools" && <span className="tab-count">{trace.steps.length}</span>}
                </button>
              ))}
            </nav>

            <div className="inspector-body">
              {tab === "overview" && <Overview trace={trace} />}
              {tab === "tools" && <Tools trace={trace} />}
              {tab === "retrieval" && <Retrieval trace={trace} />}
              {tab === "prompt" && (
                <section className="panel">
                  <h3>Reply prompt</h3>
                  <pre className="code">{trace.systemPrompt}</pre>
                  {trace.routerPrompt && (
                    <>
                      <h3>Router prompt</h3>
                      <pre className="code">{trace.routerPrompt}</pre>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1400);
                    }}
                  >
                    <CopyIcon size={13} />
                    {copied ? "Copied" : "Copy trace JSON"}
                  </button>
                </section>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function Overview({ trace }: { trace: TurnTrace }) {
  const decision = DECISION[trace.guardrail.decision];
  const retrieval = trace.retrieval;
  return (
    <>
      <section className="panel">
        <div className="panel-row">
          <span className={`badge badge-${decision.tone}`}>{decision.label}</span>
          <span className="muted">{INTENT[trace.intent]}</span>
          <span className="muted push">{trace.mode === "voice" ? "Voice" : "Chat"}</span>
        </div>
        <p className="panel-text">{trace.guardrail.reason}</p>
        {trace.error && (
          <p className="callout callout-tomato">
            <strong>{trace.error.code}</strong> {trace.error.message}
          </p>
        )}
      </section>

      <section className="metrics">
        <Metric label="End-to-end" value={ms(trace.e2eMs)} />
        <Metric label="Est. cost" value={cost(trace.costUsd)} />
        <Metric label="Input tokens" value={trace.usage.promptTokens.toLocaleString()} />
        <Metric label="Output tokens" value={trace.usage.completionTokens.toLocaleString()} />
        <Metric label="Model" value={shortModel(trace.model)} title={trace.model} />
        <Metric label="Planner" value={trace.planner} />
      </section>

      {trace.routing && (
        <section className="panel">
          <h3>Routing</h3>
          <div className="panel-row small">
            <span className={`badge badge-${trace.routing.source === "llm" ? "sage" : "neutral"}`}>
              {trace.routing.source === "llm" ? "Model router" : "Keyword rules"}
            </span>
            <span className="muted">{IDENTITY[trace.identity ?? "none"]}</span>
          </div>
          {trace.routing.rationale && <p className="panel-text">{trace.routing.rationale}</p>}
          {trace.routing.source === "llm" && trace.routing.rulesIntent !== trace.routing.intent && (
            <p className="panel-text muted">Keyword rules would have chosen {INTENT[trace.routing.rulesIntent]}.</p>
          )}
          {trace.retrieval && (
            <p className="panel-text muted">
              Search query: <span className="mono">{trace.routing.searchQuery}</span>
            </p>
          )}
        </section>
      )}

      {retrieval && (
        <section className="panel">
          <h3>Confidence</h3>
          <ScoreBar score={retrieval.topScore} threshold={retrieval.threshold} strong />
          <div className="panel-row small">
            <span>
              Top match <b className="mono">{retrieval.topScore.toFixed(2)}</b>
            </span>
            <span className="push">
              Threshold <b className="mono">{retrieval.threshold.toFixed(2)}</b>
            </span>
          </div>
          <p className="panel-text muted">{retrieval.decision}</p>
        </section>
      )}

      {trace.notes.length > 0 && (
        <section className="panel">
          <h3>Guardrail notes</h3>
          <ul className="notes">
            {trace.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Tools({ trace }: { trace: TurnTrace }) {
  if (!trace.steps.length) return <p className="muted pad">No tools ran on this turn.</p>;
  return (
    <ol className="tool-list">
      {trace.steps.map((step, i) => (
        <li key={step.id} className={step.ok ? "" : "is-failed"}>
          <div className="tool-head">
            <span className="tool-index">{i + 1}</span>
            <code className="tool-name">{step.tool}</code>
            <span className={`tool-status ${step.ok ? "text-sage" : "text-tomato"}`}>
              {step.ok ? <CheckIcon size={13} /> : <CrossIcon size={13} />}
            </span>
            <span className="tool-time mono">{ms(step.latencyMs)}</span>
          </div>
          <p className="tool-summary">{step.resultSummary}</p>
          <details className="tool-args">
            <summary>Arguments</summary>
            <pre className="code">{JSON.stringify(step.args, null, 2)}</pre>
          </details>
        </li>
      ))}
    </ol>
  );
}

function Retrieval({ trace }: { trace: TurnTrace }) {
  const retrieval = trace.retrieval;
  if (!retrieval) return <p className="muted pad">This turn did not search the knowledge base.</p>;
  return (
    <>
      <section className="panel">
        <h3>Query</h3>
        <pre className="code">{retrieval.query}</pre>
        <div className="panel-row small">
          <span>{retrieval.provider === "openai" ? "OpenAI embeddings" : "Local embeddings"}</span>
          {retrieval.expanded && <span className="badge badge-neutral">Expanded</span>}
          <span className={`badge push badge-${retrieval.confident ? "sage" : "amber"}`}>
            {retrieval.confident ? "Confident" : "Below threshold"}
          </span>
        </div>
      </section>
      <section className="panel">
        <h3>Top chunks</h3>
        <ol className="chunk-list">
          {retrieval.hits.map((hit) => (
            <li key={hit.id}>
              <div className="chunk-head">
                <span className="chunk-title">
                  {hit.title} <span className="muted">· {hit.section}</span>
                </span>
                <span className="mono">{hit.score.toFixed(2)}</span>
              </div>
              <ScoreBar score={hit.score} threshold={retrieval.threshold} />
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function ScoreBar({ score, threshold, strong }: { score: number; threshold: number; strong?: boolean }) {
  const pass = score >= threshold;
  return (
    <div className={`score ${strong ? "is-strong" : ""}`}>
      <span className={`score-fill ${pass ? "is-pass" : "is-fail"}`} style={{ width: `${clamp(score) * 100}%` }} />
      <span className="score-mark" style={{ left: `${clamp(threshold) * 100}%` }} />
    </div>
  );
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value" title={title ?? value}>
        {value}
      </span>
    </div>
  );
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}
