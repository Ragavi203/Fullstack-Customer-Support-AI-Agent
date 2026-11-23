"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Mode, SimulateFault } from "@/lib/types";
import { CALLERS, CallerPanel } from "./CallerPanel";
import { shortModel } from "./format";
import { AlertIcon, MicIcon, PanelIcon, SendIcon } from "./Icons";
import { Inspector } from "./Inspector";
import { MessageList } from "./MessageList";
import { useAgentStream } from "./useAgentStream";
import { useVoice } from "./useVoice";
import { VoiceStage } from "./VoiceStage";

export function SupportDesk() {
  const agent = useAgentStream();
  const [mode, setMode] = useState<Mode>("chat");
  const [caller, setCaller] = useState<string | null>(CALLERS[0].email);
  const [draft, setDraft] = useState("");
  const [fault, setFault] = useState<SimulateFault>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [traceId, setTraceId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastAssistant = [...agent.messages].reverse().find((message) => message.role === "assistant");
  const activeCustomer = agent.customers.find((customer) => customer.email === caller) ?? null;

  useEffect(() => {
    if (window.matchMedia("(min-width: 1280px)").matches) setInspectorOpen(true);
  }, []);

  useEffect(() => {
    setTraceId(agent.traces[agent.traces.length - 1]?.id ?? null);
  }, [agent.traces]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [agent.messages.length, lastAssistant?.content, lastAssistant?.steps.length]);

  const voice = useVoice({
    enabled: mode === "voice",
    busy: agent.streaming,
    neuralVoice: Boolean(agent.health?.ttsVoice),
    assistantText: mode === "voice" ? lastAssistant?.content ?? "" : "",
    onUtterance: (text) => void agent.send(text, "voice", caller, fault),
    onBargeIn: () => agent.abort(),
  });

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || agent.streaming) return;
    setDraft("");
    void agent.send(text, mode, caller, fault);
  }

  const live = agent.health?.mode === "live";

  return (
    <div className={`app ${inspectorOpen ? "has-inspector" : ""} ${mode === "voice" ? "is-voice" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <span className="brand-name">Linden Mobile</span>
          <span className="brand-divider" />
          <span className="brand-product">Care</span>
        </div>

        <div className="segmented" role="tablist" aria-label="Channel">
          <button type="button" role="tab" aria-selected={mode === "chat"} onClick={() => setMode("chat")}>
            Chat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "voice"}
            onClick={() => {
              voice.arm();
              setMode("voice");
            }}
          >
            <MicIcon size={13} />
            Voice
          </button>
        </div>

        <div className="topbar-right">
          <span
            className="env"
            title={live ? `${agent.health?.model} · model-driven planner with tool policy checks` : "Deterministic planner, no API key"}
          >
            <span className={`env-dot ${live ? "is-live" : ""}`} />
            {live ? `Live · ${shortModel(agent.health?.model)}` : "Demo mode"}
          </span>
          <button
            type="button"
            className={`btn btn-sm ${inspectorOpen ? "is-pressed" : ""}`}
            onClick={() => setInspectorOpen((open) => !open)}
            aria-pressed={inspectorOpen}
          >
            <PanelIcon size={14} />
            Inspector
          </button>
        </div>
      </header>

      <div className="workspace">
        <CallerPanel
          customers={agent.customers}
          selected={caller}
          onSelect={setCaller}
          fault={fault}
          onFault={setFault}
          onReset={() => void agent.reset()}
          health={agent.health}
          sessionId={agent.sessionId}
        />

        <main className="conversation">
          <div className="conversation-scroll" ref={scroller}>
            <div className="conversation-inner">
              <MessageList
                messages={agent.messages}
                callerName={activeCustomer?.name ?? null}
                onSuggest={(text) => void agent.send(text, mode, caller, fault)}
                onInspect={(id) => {
                  setTraceId(id);
                  setInspectorOpen(true);
                }}
              />
            </div>
          </div>

          <div className="dock">
            <div className="conversation-inner">
              {agent.banner && (
                <div className={`alert alert-${agent.banner.tone}`} role="alert">
                  <AlertIcon size={16} className="alert-icon" />
                  <div className="alert-text">
                    <strong>{agent.banner.title}</strong>
                    <span>{agent.banner.message}</span>
                  </div>
                  {agent.banner.recoverable && (
                    <button type="button" className="btn btn-sm btn-primary" onClick={agent.retry}>
                      Retry
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => agent.setBanner(null)}>
                    Dismiss
                  </button>
                </div>
              )}

              {mode === "voice" && (
                <VoiceStage
                  phase={voice.phase}
                  bars={voice.bars}
                  caption={voice.caption}
                  error={voice.error}
                  supported={voice.supported}
                  muted={voice.muted}
                  onToggleMute={voice.toggleMute}
                  onInterrupt={voice.interrupt}
                />
              )}

              <form className="composer" onSubmit={submit}>
                <textarea
                  value={draft}
                  rows={1}
                  maxLength={2000}
                  placeholder={mode === "voice" ? "Type instead of speaking…" : `Message Linden Care${activeCustomer ? ` as ${activeCustomer.name}` : ""}…`}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                />
                <div className="composer-bar">
                  <span className="composer-hint">
                    {fault ? (
                      <span className="text-tomato">Next turn injects: {faultLabel(fault)}</span>
                    ) : (
                      "Enter to send · Shift + Enter for a new line"
                    )}
                  </span>
                  {agent.streaming ? (
                    <button type="button" className="btn btn-sm" onClick={agent.abort}>
                      Stop
                    </button>
                  ) : (
                    <button type="submit" className="btn btn-sm btn-primary" disabled={!draft.trim()}>
                      <SendIcon size={13} />
                      Send
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </main>

        <Inspector
          open={inspectorOpen}
          traces={agent.traces}
          selectedId={traceId}
          onSelect={setTraceId}
          onClose={() => setInspectorOpen(false)}
        />
      </div>
    </div>
  );
}

function faultLabel(fault: Exclude<SimulateFault, null>): string {
  if (fault === "timeout") return "model timeout";
  if (fault === "rate_limit") return "rate limit";
  return "tool failure mid-chain";
}
