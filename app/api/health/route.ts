import { listPublicCustomers } from "@/lib/data/customers";
import { activeProvider, ttsVoice } from "@/lib/llm/provider";
import { indexStats } from "@/lib/rag/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const index = await indexStats();
  const llm = activeProvider();
  return Response.json({
    ok: true,
    mode: llm ? "live" : "demo",
    model: llm ? `${llm.label} · ${llm.model}` : null,
    ttsVoice: ttsVoice(),
    chunks: index.chunks,
    provider: index.provider,
    warning: index.warning,
    customers: listPublicCustomers(),
  });
}
