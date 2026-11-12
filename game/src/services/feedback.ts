export type FeedbackStatus = 'pending' | 'retry' | 'ready' | 'failed';

export type FeedbackRecord = {
  id: string;
  stageId: string;
  npcName: string;
  text: string;
  createdAt: number;
  status: FeedbackStatus;
  attempts: number;
  feedback?: string;
  error?: string;
  nextAttemptAt?: number;
};

export type FeedbackQueueOptions = {
  /** Stable account ID supplied by the signed-in app. Never pass a bearer token. */
  accountId: string;
  apiBase: string;
  headers(): HeadersInit;
  onChange(records: readonly FeedbackRecord[]): void;
};

const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000];

function isRecord(value: unknown): value is FeedbackRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as FeedbackRecord;
  return typeof record.id === 'string' && typeof record.text === 'string'
    && typeof record.stageId === 'string' && typeof record.npcName === 'string'
    && Number.isFinite(record.createdAt) && Number.isInteger(record.attempts)
    && record.attempts >= 0 && ['pending', 'retry', 'ready', 'failed'].includes(record.status);
}

/** Independent from NPC messages: only learner utterances are sent to this endpoint. */
export function createFeedbackQueue(options: FeedbackQueueOptions) {
  const storageKey = `bellweather:feedback:v1:${encodeURIComponent(options.accountId)}`;
  let history: FeedbackRecord[] = [];
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(stored)) history = stored.filter(isRecord).map((record) => ({ ...record }));
  } catch { /* An unreadable draft must not prevent playing. */ }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let disposed = false;
  let activeRequest: AbortController | undefined;
  const records = () => history.map((record) => ({ ...record }));
  const publish = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(history)); }
    catch { /* Keep this session's history available if browser storage is full. */ }
    options.onChange(records());
  };

  const schedule = () => {
    if (disposed || busy) return;
    if (timer !== undefined) clearTimeout(timer);
    const waiting = history.filter((record) => record.status === 'pending' || record.status === 'retry');
    if (!waiting.length) return;
    const nextAt = Math.min(...waiting.map((record) => record.nextAttemptAt || 0));
    timer = setTimeout(() => { timer = undefined; void processNext(); }, Math.max(0, nextAt - Date.now()));
  };

  const processNext = async () => {
    if (disposed || busy) return;
    const record = history.find((item) => (item.status === 'pending' || item.status === 'retry')
      && (!item.nextAttemptAt || item.nextAttemptAt <= Date.now()));
    if (!record) { schedule(); return; }
    // A tab closed after sending the final request must not restart a paid retry loop.
    if (record.attempts > RETRY_DELAYS.length) {
      record.status = 'failed'; record.error = 'Feedback is unavailable. Retry when you are ready.';
      publish(); schedule(); return;
    }
    busy = true;
    record.status = 'pending';
    record.attempts += 1;
    delete record.nextAttemptAt;
    publish();
    const controller = new AbortController();
    activeRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    let retryable = true;
    try {
      const response = await fetch(`${options.apiBase}/api/world-game/feedback`, {
        method: 'POST', headers: options.headers(), signal: controller.signal,
        body: JSON.stringify({ text: record.text, ...providerSettings() })
      });
      if (!response.ok) {
        retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new Error(response.status === 401 || response.status === 403
          ? 'Sign in from the English app to receive feedback.'
          : 'Feedback is unavailable. Retry when you are ready.');
      }
      const data = await response.json() as { text?: unknown };
      if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('The feedback response was empty.');
      record.feedback = data.text;
      record.status = 'ready';
      delete record.error;
    } catch (error) {
      if (disposed) return;
      const delay = RETRY_DELAYS[record.attempts - 1];
      record.error = error instanceof Error ? error.message : 'Feedback is unavailable.';
      if (retryable && delay !== undefined) {
        record.status = 'retry';
        record.nextAttemptAt = Date.now() + delay;
      } else record.status = 'failed';
    } finally {
      clearTimeout(timeout);
      activeRequest = undefined;
      busy = false;
      if (!disposed) { publish(); schedule(); }
    }
  };

  publish();
  schedule();
  return {
    records,
    enqueue(turn: Pick<FeedbackRecord, 'text' | 'stageId' | 'npcName'>) {
      const text = turn.text.trim();
      if (disposed || !text || text.length > 1200) return;
      const record: FeedbackRecord = {
        ...turn, text, id: crypto.randomUUID(), createdAt: Date.now(), status: 'pending', attempts: 0
      };
      history.push(record);
      publish(); schedule();
      return record.id;
    },
    retry(id: string) {
      const record = history.find((item) => item.id === id);
      if (!record || record.status !== 'failed' || disposed) return;
      record.status = 'pending'; record.attempts = 0;
      delete record.nextAttemptAt; delete record.error;
      publish(); schedule();
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      activeRequest?.abort();
    }
  };
}

function providerSettings(): { provider: string; model?: string } {
  try {
    const settings = JSON.parse(localStorage.getItem('ai_en_settings_backup') || '{}') as Record<string, string>;
    return { provider: settings.llmProvider || 'aihub8', model: settings.llmTextModel || undefined };
  } catch { return { provider: 'aihub8' }; }
}
