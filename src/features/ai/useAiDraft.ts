import { useEffect, useState } from 'react';
import { loadAiFormDraft, saveAiFormDraft, type PendingRequest } from '../../storage/indexedDb';
import { savePendingAnswer } from '../../store/datepackStore';

const drafts = new Map<string, Record<string, string>>();
const queues = new Map<string, Promise<unknown>>();
const subscribers = new Map<string, Set<(value: Record<string, string>) => void>>();
function publish(key: string, value: Record<string, string>): void {
  drafts.set(key, value);
  subscribers.get(key)?.forEach((notify) => notify(value));
}

/** Local cache keeps unsaved input through navigation; IndexedDB survives restart. */
export function useAiForm<T extends Record<string, string>>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => ({ ...initial, ...drafts.get(key) }) as T);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const notify = (next: Record<string, string>) => setValue({ ...initial, ...next } as T);
    const listeners = subscribers.get(key) ?? new Set();
    listeners.add(notify);
    subscribers.set(key, listeners);
    const cached = drafts.get(key) as T | undefined;
    setValue({ ...initial, ...cached });
    void loadAiFormDraft(key)
      .then((stored) => {
        if (!active || drafts.has(key)) return;
        if (
          stored &&
          typeof stored === 'object' &&
          Object.values(stored).every((v) => typeof v === 'string')
        ) {
          const restored = { ...initial, ...stored } as T;
          publish(key, restored);
          setValue(restored);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      listeners.delete(notify);
      if (!listeners.size) subscribers.delete(key);
    };
  }, [key]);
  function persist(next: T): void {
    publish(key, next);
    setValue(next);
    const write = (queues.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => saveAiFormDraft(key, next));
    queues.set(key, write);
    void write.then(
      () => setError(false),
      () => setError(true),
    );
  }
  return {
    value,
    change: (field: keyof T, text: string) =>
      persist({ ...initial, ...(drafts.get(key) ?? value), [field]: text } as T),
    error,
    retry: () => persist(value),
  };
}

const unsavedAnswers = new Map<string, string>();
const failedAnswers = new Set<string>();
export function recoverAnswer(request: PendingRequest): string {
  return unsavedAnswers.get(request.id) ?? request.answerText ?? '';
}
export function useAnswerSave(request: PendingRequest | null | undefined) {
  const [error, setError] = useState(() => Boolean(request && failedAnswers.has(request.id)));
  useEffect(() => {
    setError(Boolean(request && failedAnswers.has(request.id)));
  }, [request?.id]);
  function save(text: string): void {
    if (!request) return;
    const id = request.id;
    unsavedAnswers.set(id, text);
    void savePendingAnswer(id, text).then(
      () => {
        if (unsavedAnswers.get(id) === text) {
          unsavedAnswers.delete(id);
          failedAnswers.delete(id);
          setError(false);
        }
      },
      () => {
        if (unsavedAnswers.get(id) === text) {
          failedAnswers.add(id);
          setError(true);
        }
      },
    );
  }
  return { save, error, retry: (text: string) => save(text) };
}
