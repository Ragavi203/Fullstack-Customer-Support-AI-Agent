import { ttsVoice } from "@/lib/llm/provider";
import { takeToken } from "@/lib/resilience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHARS = 1200;

export async function POST(req: Request) {
  const voice = ttsVoice();
  if (!voice) return Response.json({ error: "Speech is not configured." }, { status: 501 });

  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = (body?.text ?? "").trim();
  if (!text) return Response.json({ error: "Text is required." }, { status: 400 });
  if (text.length > MAX_CHARS) return Response.json({ error: "Text is too long." }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = Number(process.env.RATE_LIMIT_PER_MINUTE || 20) * 8;
  if (!takeToken(`tts:${ip}`, limit).ok) {
    return Response.json({ error: "Speech rate limit reached." }, { status: 429 });
  }

  const upstream = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_id: voice,
      language: "en",
      text_normalization: true,
      optimize_streaming_latency: 0,
      output_format: { codec: "mp3", sample_rate: 44100, bit_rate: 192000 },
    }),
    signal: req.signal,
  }).catch(() => null);

  if (!upstream?.ok || !upstream.body) {
    const status = upstream?.status ?? 502;
    return Response.json({ error: `Speech request failed (${status}).` }, { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
