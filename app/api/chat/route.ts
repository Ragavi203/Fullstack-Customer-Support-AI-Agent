import { runTurn } from "@/lib/agent/orchestrator";
import { takeToken } from "@/lib/resilience";
import { getOrCreateSession, withSessionLock } from "@/lib/session/store";
import type { Mode, SimulateFault } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ChatBody {
  sessionId?: string;
  text?: string;
  mode?: Mode;
  profileEmail?: string | null;
  simulate?: string | null;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as ChatBody | null;
  if (!body) return Response.json({ error: "Invalid JSON." }, { status: 400 });
  const text = (body.text ?? "").trim();
  if (!text) return Response.json({ error: "Message is required." }, { status: 400 });
  if (text.length > 2000) return Response.json({ error: "Message is too long." }, { status: 400 });

  const mode: Mode = body.mode === "voice" ? "voice" : "chat";
  const profileEmail = typeof body.profileEmail === "string" && body.profileEmail.includes("@") ? body.profileEmail : null;
  const requested = isFault(body.simulate) ? body.simulate : null;
  const session = getOrCreateSession(body.sessionId ?? null, profileEmail);

  const limit = Number(process.env.RATE_LIMIT_PER_MINUTE || 20);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const sessionBudget = takeToken(`session:${session.id}`, limit);
  const ipBudget = takeToken(`ip:${ip}`, limit * 4);
  const simulate: SimulateFault = requested ?? (!sessionBudget.ok || !ipBudget.ok ? "rate_limit" : null);

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      emit("ready", { sessionId: session.id });
      try {
        await withSessionLock(session.id, () =>
          runTurn({
            session,
            text,
            mode,
            profileEmail,
            simulate,
            signal: req.signal,
            toolPaceMs: numberEnv("TOOL_PACE_MS", 320),
            tokenPaceMs: numberEnv("TOKEN_PACE_MS", 16),
            timeoutMs: numberEnv("SIMULATE_TIMEOUT_MS", 2500),
            emit,
          }),
        );
      } catch {
        emit("error", {
          code: "UPSTREAM",
          message: "The turn failed before it could finish.",
          recoverable: true,
        });
        emit("done", { messageId: null, decision: "error", customer: null, notice: null });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function isFault(value: string | null | undefined): value is Exclude<SimulateFault, null> {
  return value === "timeout" || value === "rate_limit" || value === "tool_failure";
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}
