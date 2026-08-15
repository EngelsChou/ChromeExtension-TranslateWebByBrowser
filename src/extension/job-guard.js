export const PROVIDER_RESPONSE_TIMEOUT_MS = 55_000;
export const PROVIDER_BATCH_TIMEOUT_MS = 120_000;
export const TRANSLATION_JOB_TIMEOUT_MS = 8 * 60_000;
export const TRANSLATION_JOB_STALE_MS = PROVIDER_BATCH_TIMEOUT_MS + 30_000;

export function isActiveJob(job) {
  return job?.state === 'preparing' || job?.state === 'running';
}

export function expireStaleJob(job, now = Date.now()) {
  if (!isActiveJob(job) || !job.updatedAt || now - job.updatedAt <= TRANSLATION_JOB_STALE_MS) return job;
  return {
    ...job,
    state: 'error',
    stage: 'error',
    stale: true,
    error: `翻譯工作已超過 ${Math.round(TRANSLATION_JOB_STALE_MS / 1000)} 秒沒有進度，已自動停止。已完成的中文仍會保留，可重試或恢復原文。`,
    updatedAt: now,
  };
}

export function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.code = 'TRANSLATION_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function remainingItems(items, appliedIds) {
  return items.filter(({ id }) => !appliedIds.has(id));
}

export function splitRetryItems(items) {
  if (items.length <= 1) return [items];
  const midpoint = Math.ceil(items.length / 2);
  return [items.slice(0, midpoint), items.slice(midpoint)];
}
