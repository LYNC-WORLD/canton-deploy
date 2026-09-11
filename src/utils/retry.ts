import * as grpc from '@grpc/grpc-js';

const TRANSIENT_GRPC = new Set([
  grpc.status.UNAVAILABLE,
  grpc.status.DEADLINE_EXCEEDED,
  grpc.status.RESOURCE_EXHAUSTED,
  grpc.status.ABORTED,
]);

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const code = (err as grpc.ServiceError).code;
      const isTransient =
        (typeof code === 'number' && TRANSIENT_GRPC.has(code)) ||
        (err instanceof TypeError && /fetch failed/i.test(String(err))) ||
        (err instanceof Error && /ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(err.message));

      if (!isTransient || attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
    }
  }

  throw lastErr;
}
