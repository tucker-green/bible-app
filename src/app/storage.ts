/**
 * Tiny, exception-safe wrappers around localStorage. Every key is prefixed with "rootword:".
 * Private browsing modes and disabled storage make localStorage throw; we never let that break the app.
 */
export const STORAGE_PREFIX = 'rootword:';

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readString(key: string): string | null {
  try {
    return store()?.getItem(STORAGE_PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string | null): void {
  try {
    const s = store();
    if (!s) return;
    if (value === null) s.removeItem(STORAGE_PREFIX + key);
    else s.setItem(STORAGE_PREFIX + key, value);
  } catch {
    /* quota exceeded / disabled: ignore */
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  writeString(key, JSON.stringify(value));
}
