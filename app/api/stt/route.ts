import { takeToken } from "@/lib/resilience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000_000;
const KEYTERMS = ["Linden", "Linden Care", "Travel Pass", "eSIM", "Prepaid", "Wi-Fi Calling"];

export async function POST(req: Request) {
  if (!process.env.XAI_API_KEY) {
    return Response.json({ error: "Speech recognition is not configured." }, { status: 501 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return Response.json({ error: "Audio is required." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Audio is too long." }, { status: 413 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = Number(process.env.RATE_LIMIT_PER_MINUTE || 20) * 12;
  if (!takeToken(`stt:${ip}`, limit).ok) {
    return Response.json({ error: "Speech recognition rate limit reached." }, { status: 429 });
  }

  const upstreamBody = new FormData();
  upstreamBody.append("file", file, "speech.wav");
  upstreamBody.append("model", "grok-voice-transcribe-2.0");
  upstreamBody.append("language", "en");
  upstreamBody.append("format", "true");
  for (const term of KEYTERMS) upstreamBody.append("keyterm", term);

  const upstream = await fetch("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` },
    body: upstreamBody,
    signal: req.signal,
  }).catch(() => null);

  if (!upstream?.ok) {
    return Response.json({ error: `Transcription failed (${upstream?.status ?? 502}).` }, { status: 502 });
  }
  const json = (await upstream.json().catch(() => null)) as { text?: string } | null;
  return Response.json({ text: (json?.text ?? "").trim() });
}
