"use client";

interface QueuedLine {
  text: string;
  audio: Promise<Blob | null>;
  controller: AbortController;
}

const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i;
const PREFERRED = ["google us english", "samantha", "ava", "allison", "susan", "microsoft aria", "microsoft jenny", "karen", "daniel", "serena"];

export function spokenText(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*source:/i.test(line))
    .join(" ")
    .replace(/·/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

export function pickBrowserVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en") && !NOVELTY.test(voice.name));
  if (!english.length) return null;
  const score = (voice: SpeechSynthesisVoice) => {
    const name = voice.name.toLowerCase();
    let value = 0;
    const rank = PREFERRED.findIndex((preferred) => name.startsWith(preferred));
    if (rank >= 0) value += 100 - rank * 5;
    if (/premium|enhanced|natural|neural/.test(name)) value += 40;
    if (voice.lang === "en-US") value += 10;
    if (voice.localService === false) value += 5;
    return value;
  };
  return english.slice().sort((a, b) => score(b) - score(a))[0];
}

async function fetchSpeech(text: string, signal: AbortSignal): Promise<Blob | null> {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

export class Speaker {
  analyser: AnalyserNode | null = null;
  private queue: QueuedLine[] = [];
  private playing = false;
  private generation = 0;
  private element: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private objectUrl: string | null = null;
  private finish: (() => void) | null = null;

  constructor(
    private neural: () => boolean,
    private onTalking: (talking: boolean) => void,
  ) {}

  unlock() {
    const element = this.ensureElement();
    void this.context?.resume();
    element.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
    void element.play().catch(() => undefined);
  }

  say(text: string) {
    const clean = spokenText(text);
    if (!clean) return;
    const controller = new AbortController();
    const audio = this.neural() ? fetchSpeech(clean, controller.signal) : Promise.resolve(null);
    this.queue.push({ text: clean, audio, controller });
    if (!this.playing) void this.next(this.generation);
  }

  stop() {
    this.generation += 1;
    for (const line of this.queue) line.controller.abort();
    this.queue = [];
    this.element?.pause();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    this.finish?.();
    this.finish = null;
    this.playing = false;
    this.onTalking(false);
  }

  dispose() {
    this.stop();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    void this.context?.close();
    this.context = null;
    this.analyser = null;
    this.element = null;
  }

  private async next(generation: number) {
    const line = this.queue.shift();
    if (!line) {
      this.playing = false;
      this.onTalking(false);
      return;
    }
    this.playing = true;
    const blob = await line.audio;
    if (generation !== this.generation) return;
    const played = blob ? await this.playAudio(blob) : false;
    if (generation !== this.generation) return;
    if (!played && !this.neural()) await this.playBrowser(line.text);
    if (generation !== this.generation) return;
    void this.next(generation);
  }

  private ensureElement(): HTMLAudioElement {
    if (this.element) return this.element;
    const element = new Audio();
    this.element = element;
    try {
      const context = new AudioContext();
      const source = context.createMediaElementSource(element);
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyser.connect(context.destination);
      this.context = context;
      this.analyser = analyser;
    } catch {
      this.analyser = null;
    }
    return element;
  }

  private playAudio(blob: Blob): Promise<boolean> {
    const element = this.ensureElement();
    void this.context?.resume();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(blob);
    element.src = this.objectUrl;
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        element.onended = null;
        element.onerror = null;
        this.finish = null;
        resolve(ok);
      };
      this.finish = () => done(true);
      element.onended = () => done(true);
      element.onerror = () => done(false);
      const start = async () => {
        if (this.context?.state === "suspended") await this.context.resume();
        await element.play();
        this.onTalking(true);
      };
      start().catch(() => done(false));
    });
  }

  private playBrowser(text: string): Promise<void> {
    if (typeof window === "undefined" || !window.speechSynthesis) return Promise.resolve();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickBrowserVoice(window.speechSynthesis.getVoices());
      if (voice) utterance.voice = voice;
      utterance.rate = 1;
      const done = () => {
        this.finish = null;
        resolve();
      };
      this.finish = done;
      utterance.onstart = () => this.onTalking(true);
      utterance.onend = done;
      utterance.onerror = done;
      window.speechSynthesis.speak(utterance);
    });
  }
}
