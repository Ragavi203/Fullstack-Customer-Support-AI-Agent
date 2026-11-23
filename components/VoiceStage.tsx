"use client";

import type { VoicePhase } from "./useVoice";
import { StopIcon } from "./Icons";

interface VoiceStageProps {
  phase: VoicePhase;
  bars: number[];
  caption: string;
  error: string | null;
  supported: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onInterrupt: () => void;
}

const PHASE: Record<VoicePhase, { label: string; hint: string }> = {
  idle: { label: "Voice off", hint: "" },
  listening: { label: "Listening", hint: "A pause sends your sentence. You stay on this call." },
  muted: { label: "Muted", hint: "The microphone is off. You stay on this call." },
  thinking: { label: "Working", hint: "Running tools. You stay on this call." },
  speaking: { label: "Speaking", hint: "Talk over Linden Care to interrupt. You stay on this call." },
};

export function VoiceStage({ phase, bars, caption, error, supported, muted, onToggleMute, onInterrupt }: VoiceStageProps) {
  const canInterrupt = phase === "speaking" || phase === "thinking";
  return (
    <section className={`voice is-${phase}`} aria-live="polite">
      <div className="voice-row">
        <div className="voice-state">
          <span className="voice-dot" />
          <span className="voice-label">{PHASE[phase].label}</span>
          <span className="voice-hint">{PHASE[phase].hint}</span>
        </div>
        <div className="voice-actions">
          <button type="button" className="btn btn-sm" onClick={onToggleMute} aria-pressed={muted}>
            {muted ? "Unmute" : "Mute"}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={onInterrupt} disabled={!canInterrupt}>
            <StopIcon size={12} />
            Interrupt
          </button>
        </div>
      </div>
      <div className="wave" aria-hidden="true">
        {bars.map((level, index) => (
          <span key={index} style={{ transform: `scaleY(${Math.min(1, 0.08 + level)})` }} />
        ))}
      </div>
      <p className={`voice-caption ${caption ? "" : "is-empty"}`}>{caption === "…" ? "Hearing you…" : caption || "Live transcript appears here."}</p>
      {(!supported || error) && (
        <p className="voice-warning">{error ?? "Microphone transcription is unavailable. You can still type below."}</p>
      )}
    </section>
  );
}
