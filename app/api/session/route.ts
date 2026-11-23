import { listPublicCustomers } from "@/lib/data/customers";
import { deleteSession, getSession } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const session = id ? getSession(id) : null;
  return Response.json({
    session: session
      ? {
          id: session.id,
          profileEmail: session.profileEmail,
          messages: session.messages,
          traces: session.traces,
        }
      : null,
    customers: listPublicCustomers(),
  });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) deleteSession(id);
  return Response.json({ ok: true });
}
