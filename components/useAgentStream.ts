"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Decision, Mode, PublicCustomer, SimulateFault, StepEvent, TurnTrace } from "@/lib/types";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: Mode;
  steps: StepEvent[];
  decision?: Decision;
  interrupted?: boolean;
  traceId?: string;
  pending?: boolean;
}

export interface Banner {
  tone: "warn" | "bad" | "info";
  title: string;
  message: string;
  recoverable?: boolean;
}

export interface HealthInfo {
  mode: "live" | "demo";
  model: string | null;
  ttsVoice: string | null;
  chunks: number;
  provider: string;
  warning: string | null;
}

interface SseEvent {
  event: string;
  data: string;
}

export function useAgentStream() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [traces, setTraces] = useState<TurnTrace[]>([]);
  const [customers, setCustomers] = useState<PublicCustomer[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  const turnGen = useRef(0);
  const lastSend = useRef<{ text: string; mode: Mode; profileEmail: string | null; simulate: SimulateFault } | null>(null);
  const sessionRef = useRef<string | null>(null);

  const applyCustomer = useCallback((customer: PublicCustomer | null) => {
    if (!customer) return;
    setCustomers((current) => current.map((item) => (item.id === customer.id ? customer : item)));
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("linden-session");
    const id = stored || crypto.randomUUID();
    window.localStorage.setItem("linden-session", id);
    sessionRef.current = id;
    setSessionId(id);
    void fetch(`/api/session?id=${id}`)
      .then((res) => res.json())
      .then((payload: { session?: { messages: UiMessage[]; traces: TurnTrace[] } | null; customers: PublicCustomer[] }) => {
        setCustomers(payload.customers ?? []);
        if (payload.session) {
          const traceIds = new Set((payload.session.traces ?? []).map((trace) => trace.id));
          setMessages(
            payload.session.messages.map((message) => ({
              ...message,
              steps: message.steps ?? [],
              traceId: message.role === "assistant" && traceIds.has(message.id) ? message.id : undefined,
            })),
          );
          setTraces(payload.session.traces ?? []);
        }
      })
      .catch(() => undefined);
    void fetch("/api/health")
      .then((res) => res.json())
      .then((payload: HealthInfo & { customers?: PublicCustomer[] }) => {
        setHealth({
          mode: payload.mode,
          model: payload.model,
          ttsVoice: payload.ttsVoice ?? null,
          chunks: payload.chunks,
          provider: payload.provider,
          warning: payload.warning,
        });
        if (payload.customers?.length) setCustomers(payload.customers);
      })
      .catch(() => undefined);
  }, []);

  const updateAssistant = useCallback((patch: (message: UiMessage) => UiMessage) => {
    setMessages((current) => {
      const next = current.slice();
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") {
          next[i] = patch(next[i]);
          break;
        }
      }
      return next;
    });
  }, []);

  const send = useCallback(
    async (text: string, mode: Mode, profileEmail: string | null, simulate: SimulateFault) => {
      const trimmed = text.trim();
      if (!trimmed || streamingRef.current) return;
      const mine = ++turnGen.current;
      streamingRef.current = true;
      const id = sessionRef.current ?? crypto.randomUUID();
      sessionRef.current = id;
      setSessionId(id);
      window.localStorage.setItem("linden-session", id);
      lastSend.current = { text: trimmed, mode, profileEmail, simulate };
      setBanner(null);
      setStreaming(true);
      const assistantId = crypto.randomUUID();
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", content: trimmed, mode, steps: [] },
        { id: assistantId, role: "assistant", content: "", mode, steps: [], pending: true },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: id, text: trimmed, mode, profileEmail, simulate }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const problem = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(problem?.error || "The agent could not start this turn.");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = drainSse(buffer);
          buffer = parsed.rest;
          for (const item of parsed.events) handleEvent(item);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          updateAssistant((message) => ({
            ...message,
            pending: false,
            interrupted: true,
            content: message.content || "Interrupted.",
          }));
        } else {
          const message = error instanceof Error ? error.message : "The connection dropped.";
          updateAssistant((current) => ({ ...current, pending: false, decision: "error" }));
          setBanner({ tone: "bad", title: "Turn failed", message, recoverable: true });
        }
      } finally {
        updateAssistant((message) => (message.pending ? { ...message, pending: false } : message));
        if (turnGen.current === mine) {
          streamingRef.current = false;
          setStreaming(false);
        }
        abortRef.current = null;
      }
    },
    [updateAssistant],
  );

  function handleEvent(item: SseEvent) {
    const data = JSON.parse(item.data) as Record<string, unknown>;
    if (item.event === "ready" && typeof data.sessionId === "string") {
      sessionRef.current = data.sessionId;
      setSessionId(data.sessionId);
      return;
    }
    if (item.event === "status") {
      const step = data as unknown as StepEvent;
      updateAssistant((message) => {
        const steps = message.steps.slice();
        const index = steps.findIndex((item) => item.id === step.id);
        if (index >= 0) steps[index] = step;
        else steps.push(step);
        return { ...message, steps };
      });
      return;
    }
    if (item.event === "token" && typeof data.text === "string") {
      const text = data.text;
      updateAssistant((message) => ({ ...message, content: message.content + text }));
      return;
    }
    if (item.event === "replace" && typeof data.text === "string") {
      const text = data.text;
      updateAssistant((message) => ({ ...message, content: text }));
      return;
    }
    if (item.event === "notice") {
      setBanner({
        tone: "info",
        title: "Degraded response",
        message: String(data.message ?? "Answered from verified tools."),
      });
      return;
    }
    if (item.event === "error") {
      const code = String(data.code ?? "UPSTREAM");
      setBanner({
        tone: code === "RATE_LIMIT" ? "warn" : "bad",
        title: titleFor(code),
        message: String(data.message ?? "The turn failed."),
        recoverable: Boolean(data.recoverable),
      });
      return;
    }
    if (item.event === "trace") {
      setTraces((current) => [...current, data as unknown as TurnTrace]);
      return;
    }
    if (item.event === "done") {
      const decision = data.decision as Decision | undefined;
      const traceId = typeof data.messageId === "string" ? data.messageId : undefined;
      updateAssistant((message) => ({ ...message, decision, traceId, pending: false }));
      applyCustomer((data.customer as PublicCustomer | null) ?? null);
    }
  }

  const abort = useCallback(() => {
    turnGen.current += 1;
    streamingRef.current = false;
    setStreaming(false);
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(() => {
    const last = lastSend.current;
    if (!last) return;
    void send(last.text, last.mode, last.profileEmail, null);
  }, [send]);

  const reset = useCallback(async () => {
    abortRef.current?.abort();
    const id = sessionRef.current;
    await fetch("/api/demo/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: id }),
    }).then(async (res) => {
      const payload = (await res.json()) as { customers: PublicCustomer[] };
      setCustomers(payload.customers);
    });
    const nextId = crypto.randomUUID();
    sessionRef.current = nextId;
    window.localStorage.setItem("linden-session", nextId);
    setSessionId(nextId);
    setMessages([]);
    setTraces([]);
    setBanner(null);
    setStreaming(false);
  }, []);

  return {
    sessionId,
    messages,
    traces,
    customers,
    health,
    streaming,
    banner,
    setBanner,
    send,
    abort,
    retry,
    reset,
  };
}

function drainSse(buffer: string): { events: SseEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: SseEvent[] = [];
  for (const part of parts) {
    if (!part.trim() || part.startsWith(":")) continue;
    let event = "message";
    const data: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length) events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}

function titleFor(code: string): string {
  if (code === "TIMEOUT") return "Model timeout";
  if (code === "RATE_LIMIT") return "Rate limited";
  if (code === "TOOL_FAILURE") return "Tool failed mid-turn";
  return "Upstream error";
}
