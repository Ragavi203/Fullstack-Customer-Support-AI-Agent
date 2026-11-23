"use client";

import { useState } from "react";
import type { StepEvent } from "@/lib/types";
import { DECISION, ms, stepLabel } from "./format";
import { ArrowIcon, CheckIcon, ChevronIcon, CrossIcon, MicIcon, Spinner } from "./Icons";
import type { UiMessage } from "./useAgentStream";

const SUGGESTIONS: Array<{ group: string; text: string }> = [
  { group: "Billing", text: "I never used my Travel Pass. Can I get a refund for my last charge?" },
  { group: "Troubleshooting", text: "My phone shows SOS only since this morning" },
  { group: "Policy", text: "What's the Business SLA during an outage?" },
  { group: "Account", text: "Change my billing email to finance@acme.com" },
  { group: "Guardrail", text: "What's the best pizza in Brooklyn?" },
];

interface MessageListProps {
  messages: UiMessage[];
  callerName: string | null;
  onSuggest: (text: string) => void;
  onInspect: (traceId: string) => void;
}

export function MessageList({ messages, callerName, onSuggest, onInspect }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <h1>New conversation</h1>
        <p>
          {callerName
            ? `${callerName} is on the line. Ask a question, or start from one of these.`
            : "No account is attached yet. Ask a question, or start from one of these."}
        </p>
        <ul className="suggestions">
          {SUGGESTIONS.map((item) => (
            <li key={item.text}>
              <button type="button" onClick={() => onSuggest(item.text)}>
                <span className="suggestion-group">{item.group}</span>
                <span className="suggestion-text">{item.text}</span>
                <ArrowIcon className="suggestion-arrow" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <ol className="messages">
      {messages.map((message) =>
        message.role === "user" ? (
          <li key={message.id} className="msg msg-user">
            <div className="msg-user-bubble">
              {message.mode === "voice" && <MicIcon size={12} className="msg-voice" />}
              {message.content}
            </div>
          </li>
        ) : (
          <li key={message.id} className="msg msg-agent">
            <div className="msg-head">
              <span className="agent-mark">L</span>
              <span className="msg-author">Linden Care</span>
              {message.mode === "voice" && <span className="msg-meta">Voice</span>}
              {message.decision && (
                <span className={`badge badge-${DECISION[message.decision].tone}`}>{DECISION[message.decision].label}</span>
              )}
              {message.interrupted && <span className="badge badge-amber">Interrupted</span>}
              {message.traceId && (
                <button type="button" className="link-btn" onClick={() => onInspect(message.traceId!)}>
                  View trace
                </button>
              )}
            </div>
            {message.steps.length > 0 && <RunTimeline steps={message.steps} live={Boolean(message.pending)} />}
            {message.content ? (
              <div className="msg-body">
                {message.content.split(/\n{2,}/).map((para, index) => (
                  <p key={index} className={para.startsWith("Source:") ? "msg-source" : undefined}>
                    {para}
                  </p>
                ))}
                {message.pending && <span className="caret" />}
              </div>
            ) : (
              message.pending && message.steps.length === 0 && <div className="msg-body muted">Connecting…</div>
            )}
          </li>
        ),
      )}
    </ol>
  );
}

function RunTimeline({ steps, live }: { steps: StepEvent[]; live: boolean }) {
  const [open, setOpen] = useState(true);
  const tools = steps.filter((step) => step.tool !== "understand" && step.tool !== "generate");
  const failed = steps.some((step) => step.status === "error");
  const running = steps.find((step) => step.status === "started");
  const summary = running
    ? stepLabel(running.tool, running.label, "started")
    : `${tools.length} tool ${tools.length === 1 ? "call" : "calls"}${failed ? " · stopped on error" : ""}`;

  return (
    <div className={`run ${open ? "is-open" : ""}`}>
      <button type="button" className="run-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {live && running ? <Spinner size={13} /> : failed ? <CrossIcon size={13} className="text-tomato" /> : <CheckIcon size={13} className="text-sage" />}
        <span className="run-title">{summary}</span>
        <ChevronIcon size={14} className="run-chevron" />
      </button>
      {open && (
        <ol className="run-steps">
          {steps.map((step) => (
            <li key={step.id} className={`run-step is-${step.status}`}>
              <span className="run-icon">
                {step.status === "started" ? (
                  <Spinner size={12} />
                ) : step.status === "error" ? (
                  <CrossIcon size={12} />
                ) : (
                  <CheckIcon size={12} />
                )}
              </span>
              <span className="run-label">{stepLabel(step.tool, step.label, step.status)}</span>
              <span className="run-detail">{step.tool === "generate" ? "" : step.detail ?? ""}</span>
              <span className="run-time">{step.latencyMs !== undefined && step.status !== "started" ? ms(step.latencyMs) : ""}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
