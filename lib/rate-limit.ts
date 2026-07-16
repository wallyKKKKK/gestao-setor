type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitEntry>();

export function checkRateLimit(key: string, maxAttempts: number, windowMs: number) {
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (current.count >= maxAttempts) {
    return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  }

  current.count += 1;
  buckets.set(key, current);
  return null;
}

export function rateLimitResponse(retrySeconds: number) {
  return Response.json(
    { error: `Muitas tentativas. Aguarde ${retrySeconds} segundo${retrySeconds === 1 ? "" : "s"} e tente novamente.` },
    {
      status: 429,
      headers: {
        "Retry-After": String(retrySeconds),
      },
    },
  );
}