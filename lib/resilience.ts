type Bucket = { tokens: number; updated: number };

const buckets = new Map<string, Bucket>();

export function takeToken(
  key: string,
  limit: number,
  windowMs = 60_000,
): { ok: boolean; retryAfterMs: number; remaining: number } {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: limit, updated: now };
  const refill = ((now - bucket.updated) / windowMs) * limit;
  bucket.tokens = Math.min(limit, bucket.tokens + refill);
  bucket.updated = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    const retryAfterMs = Math.ceil(((1 - bucket.tokens) / limit) * windowMs);
    return { ok: false, retryAfterMs, remaining: 0 };
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return { ok: true, retryAfterMs: 0, remaining: Math.floor(bucket.tokens) };
}

export function resetRateLimits(): void {
  buckets.clear();
}

export class AgentError extends Error {
  code: "TIMEOUT" | "RATE_LIMIT" | "TOOL_FAILURE" | "UPSTREAM";
  recoverable: boolean;

  constructor(
    code: "TIMEOUT" | "RATE_LIMIT" | "TOOL_FAILURE" | "UPSTREAM",
    message: string,
    recoverable = true,
  ) {
    super(message);
    this.code = code;
    this.recoverable = recoverable;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message === "aborted");
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
