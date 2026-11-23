import type { Session, TurnTrace } from "../types";

type StoreGlobal = typeof globalThis & { __lindenSessions?: Map<string, Session> };

function map(): Map<string, Session> {
  const g = globalThis as StoreGlobal;
  if (!g.__lindenSessions) g.__lindenSessions = new Map();
  return g.__lindenSessions;
}

const locks = new Map<string, Promise<unknown>>();

export function createSession(profileEmail: string | null = null): Session {
  const now = Date.now();
  const session: Session = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    profileEmail,
    messages: [],
    traces: [],
  };
  map().set(session.id, session);
  return session;
}

export function getSession(id: string): Session | null {
  return map().get(id) ?? null;
}

export function getOrCreateSession(id: string | null | undefined, profileEmail: string | null): Session {
  if (id) {
    const existing = map().get(id);
    if (existing) {
      existing.profileEmail = profileEmail;
      existing.updatedAt = Date.now();
      return existing;
    }
  }
  const session = createSession(profileEmail);
  if (id && id !== session.id) {
    map().delete(session.id);
    session.id = id;
    map().set(id, session);
  }
  return session;
}

export function deleteSession(id: string): void {
  map().delete(id);
}

export function rememberTrace(session: Session, trace: TurnTrace): void {
  session.traces.push(trace);
  if (session.traces.length > 30) session.traces.splice(0, session.traces.length - 30);
  session.updatedAt = Date.now();
}

export function withSessionLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(id, run.then(() => undefined, () => undefined));
  return run;
}
