"use client";

import { useEffect, useRef, useState } from "react";
import { Speaker } from "./speaker";

export type VoicePhase = "idle" | "listening" | "thinking" | "speaking" | "muted";

interface UseVoiceOptions {
  enabled: boolean;
  busy: boolean;
  neuralVoice: boolean;
  assistantText: string;
  onUtterance: (text: string) => void;
  onBargeIn: () => void;
}

const BAR_COUNT = 48;

export function useVoice({ enabled, busy, neuralVoice, assistantText, onUtterance, onBargeIn }: UseVoiceOptions) {
  const [bars, setBars] = useState<number[]>(() => Array.from({ length: BAR_COUNT }, () => 0.06));
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const supported = true;
  const [talking, setTalking] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const enabledRef = useRef(enabled);
  const busyRef = useRef(busy);
  const textRef = useRef(assistantText);
  const onUtteranceRef = useRef(onUtterance);
  const onBargeInRef = useRef(onBargeIn);
  const bargedRef = useRef(false);
  const talkingRef = useRef(false);
  const queuedRef = useRef(0);
  const acceptedRef = useRef("");
  const primedRef = useRef(false);
  const neuralRef = useRef(neuralVoice);
  const speakerRef = useRef<Speaker | null>(null);

  function speaker(): Speaker {
    if (!speakerRef.current) {
      speakerRef.current = new Speaker(
        () => neuralRef.current,
        (value) => {
          talkingRef.current = value;
          setTalking(value);
        },
      );
    }
    return speakerRef.current;
  }

  function stopSpeaking() {
    speakerRef.current?.stop();
  }

  useEffect(() => () => speakerRef.current?.dispose(), []);

  useEffect(() => {
    neuralRef.current = neuralVoice;
    enabledRef.current = enabled;
    busyRef.current = busy;
    textRef.current = assistantText;
    onUtteranceRef.current = onUtterance;
    onBargeInRef.current = onBargeIn;
    talkingRef.current = talking;
    mutedRef.current = muted;
  }, [enabled, busy, neuralVoice, assistantText, onUtterance, onBargeIn, talking, muted]);

  useEffect(() => {
    if (!enabled) {
      stopSpeaking();
      queuedRef.current = 0;
      acceptedRef.current = "";
      primedRef.current = false;
      setTalking(false);
      setMuted(false);
      setCaption("");
      return;
    }
    if (!primedRef.current) {
      primedRef.current = true;
      queuedRef.current = assistantText.length;
      acceptedRef.current = assistantText;
      return;
    }
    if (!assistantText.startsWith(acceptedRef.current)) {
      stopSpeaking();
      queuedRef.current = 0;
      acceptedRef.current = "";
    }
    if (!busy && !assistantText) return;
    const rest = assistantText.slice(queuedRef.current);
    if (!rest) return;
    let end = rest.length;
    if (busy) {
      const boundaries = [...rest.matchAll(/[.!?](?=\s|$)/g)];
      const last = boundaries.at(-1);
      if (!last || last.index === undefined) return;
      end = last.index + 1;
    }
    const chunk = rest.slice(0, end).trim();
    queuedRef.current += end;
    acceptedRef.current = assistantText.slice(0, queuedRef.current);
    if (chunk) speaker().say(chunk);
    // speaker() is a stable lazy getter over a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantText, busy, enabled]);

  useEffect(() => {
    if (!busy) bargedRef.current = false;
  }, [busy]);

  function arm() {
    speaker().unlock();
  }

  useEffect(() => {
    if (!enabled) return;
    let audio: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let processor: ScriptProcessorNode | null = null;
    let frame = 0;
    let stopped = false;
    let micAnalyser: AnalyserNode | null = null;
    const pieces: Float32Array[] = [];
    let sampleCount = 0;
    let hearing = false;
    let lastVoiceAt = 0;
    let lastPartialAt = 0;
    let partialSamples = 0;
    let epoch = 0;
    let busyTranscribe = false;
    let loudFrames = 0;
    const freq = new Uint8Array(64);
    const loop = () => {
      if (stopped) return;
      const source = (talkingRef.current ? speakerRef.current?.analyser : null) ?? micAnalyser;
      if (source) source.getByteFrequencyData(freq);
      else freq.fill(0);
      const next = Array.from({ length: BAR_COUNT }, (_, index) => {
        const mirrored = Math.abs(index - (BAR_COUNT - 1) / 2);
        const bin = Math.min(freq.length - 1, Math.floor(mirrored * 1.2));
        const value = freq[bin] / 255;
        if (talkingRef.current && value < 0.12) {
          const t = Date.now() / 160;
          return 0.18 + Math.abs(Math.sin(t + index * 0.45) * Math.cos(t * 0.6 + index * 0.2)) * 0.62;
        }
        return Math.max(0.06, value);
      });
      setBars(next);
      frame = requestAnimationFrame(loop);
    };
    loop();

    const resetUtterance = () => {
      pieces.length = 0;
      sampleCount = 0;
      hearing = false;
      partialSamples = 0;
      loudFrames = 0;
    };

    const snapshot = () => {
      const merged = new Float32Array(sampleCount);
      let offset = 0;
      for (const piece of pieces) {
        merged.set(piece, offset);
        offset += piece.length;
      }
      return merged;
    };

    const transcribe = async (samples: Float32Array, rate: number, mine: number, isFinal: boolean) => {
      busyTranscribe = true;
      try {
        const text = await requestTranscript(samples, rate);
        if (stopped || mine !== epoch) return;
        if (!text) {
          if (isFinal) setCaption("");
          return;
        }
        setCaption(text);
        setError(null);
        if (!isFinal) return;
        const command = voiceCommand(text);
        if (command === "mute") {
          setMuted(true);
          setCaption("");
          return;
        }
        if (command === "unmute") {
          setMuted(false);
          setCaption("");
          return;
        }
        if (command === "stop") {
          stopSpeaking();
          setTalking(false);
          onBargeInRef.current();
          setCaption("");
          return;
        }
        onUtteranceRef.current(text);
      } catch {
        if (!stopped && isFinal && mine === epoch) setError("Couldn't transcribe that. Try again, or type below.");
      } finally {
        busyTranscribe = false;
      }
    };

    const timer = window.setInterval(() => {
      if (stopped || !hearing || !audio || talkingRef.current || mutedRef.current) return;
      const rate = audio.sampleRate;
      const now = Date.now();
      const longEnough = sampleCount > rate * 0.4;
      const paused = now - lastVoiceAt > 700;
      const grew = sampleCount - partialSamples > rate * 0.45;
      if (paused && longEnough && !busyTranscribe) {
        const mine = ++epoch;
        const samples = snapshot();
        resetUtterance();
        bargedRef.current = false;
        void transcribe(samples, rate, mine, true);
        return;
      }
      if (!paused && grew && now - lastPartialAt > 900 && !busyTranscribe) {
        lastPartialAt = now;
        partialSamples = sampleCount;
        void transcribe(snapshot(), rate, ++epoch, false);
      }
    }, 120);

    void navigator.mediaDevices
      ?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((mic) => {
        if (stopped) {
          mic.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = mic;
        audio = new AudioContext();
        void audio.resume();
        const source = audio.createMediaStreamSource(mic);
        const analyser = audio.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);
        micAnalyser = analyser;
        processor = audio.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        const mute = audio.createGain();
        mute.gain.value = 0;
        processor.connect(mute);
        mute.connect(audio.destination);
        processor.onaudioprocess = (event) => {
          if (stopped) return;
          if (mutedRef.current) {
            if (hearing) resetUtterance();
            return;
          }
          const input = event.inputBuffer.getChannelData(0);
          let sum = 0;
          for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
          const rms = Math.sqrt(sum / input.length);
          if (talkingRef.current) {
            loudFrames = rms > 0.05 ? loudFrames + 1 : 0;
            if (loudFrames > 6 && !bargedRef.current) {
              bargedRef.current = true;
              stopSpeaking();
              setTalking(false);
              onBargeInRef.current();
              resetUtterance();
            }
            return;
          }
          if (busyRef.current && !bargedRef.current) return;
          if (rms > 0.015) {
            if (!hearing) setCaption("…");
            hearing = true;
            lastVoiceAt = Date.now();
          } else if (!hearing) {
            return;
          }
          const copy = new Float32Array(input);
          pieces.push(copy);
          sampleCount += copy.length;
          const rate = audio?.sampleRate ?? 48000;
          if (sampleCount > rate * 15 && !busyTranscribe) {
            const mine = ++epoch;
            const samples = snapshot();
            resetUtterance();
            void transcribe(samples, rate, mine, true);
          }
        };
      })
      .catch(() => setError("Microphone permission is blocked. You can still type."));

    return () => {
      stopped = true;
      window.clearInterval(timer);
      cancelAnimationFrame(frame);
      processor?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      void audio?.close();
      stopSpeaking();
    };
    // talking is read inside the animation frame; restarting the mic on every syllable would drop audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const phase: VoicePhase = !enabled ? "idle" : talking ? "speaking" : busy ? "thinking" : muted ? "muted" : "listening";

  return {
    phase,
    bars,
    caption,
    error,
    supported,
    muted,
    arm,
    toggleMute: () => {
      setMuted((current) => !current);
      setCaption("");
    },
    interrupt: () => {
      stopSpeaking();
      setTalking(false);
      onBargeIn();
    },
  };
}

function voiceCommand(text: string): "mute" | "unmute" | "stop" | null {
  const cleaned = text.trim().toLowerCase().replace(/[.!?]+$/g, "").trim();
  if (/^(pause|mute|hold on|hold)$/.test(cleaned)) return "mute";
  if (/^(resume|unmute|unpause)$/.test(cleaned)) return "unmute";
  if (/^(end|end voice|end call|hang up|goodbye|stop)$/.test(cleaned)) return "stop";
  return null;
}

function requestTranscript(samples: Float32Array, sampleRate: number): Promise<string> {
  const body = new FormData();
  body.append("file", wavBlob(samples, sampleRate), "speech.wav");
  return fetch("/api/stt", { method: "POST", body }).then(async (res) => {
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { text?: string };
    return (json.text ?? "").trim();
  });
}

function wavBlob(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}
