import { listPublicCustomers, resetDemoData } from "@/lib/data/customers";
import { resetRateLimits } from "@/lib/resilience";
import { deleteSession } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  resetDemoData();
  resetRateLimits();
  if (body.sessionId) deleteSession(body.sessionId);
  return Response.json({ ok: true, customers: listPublicCustomers() });
}
