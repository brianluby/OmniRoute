import { getDbInstance } from "./core";

const MAX_ATTEMPTS = 10;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function getKey(identifier: string): string {
  return `login:${identifier}`;
}

export function recordLoginFailure(identifier: string): { locked: boolean; attemptsLeft: number } {
  const db = getDbInstance();
  const key = getKey(identifier);
  const now = Date.now();
  const windowStart = now - ATTEMPT_WINDOW_MS;

  const row = db
    .prepare("SELECT value FROM key_value WHERE namespace = 'login_attempts' AND key = ?")
    .get(key) as { value: string } | undefined;

  const attempts: number[] = row
    ? JSON.parse(row.value).filter((t: number) => t > windowStart)
    : [];
  attempts.push(now);

  db.prepare(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('login_attempts', ?, ?)",
  ).run(key, JSON.stringify(attempts));

  const locked = attempts.length >= MAX_ATTEMPTS;
  return { locked, attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts.length) };
}

export function checkLoginLockout(identifier: string): { locked: boolean; retryAfterMs: number } {
  const db = getDbInstance();
  const key = getKey(identifier);
  const now = Date.now();
  const windowStart = now - ATTEMPT_WINDOW_MS;

  const row = db
    .prepare("SELECT value FROM key_value WHERE namespace = 'login_attempts' AND key = ?")
    .get(key) as { value: string } | undefined;

  if (!row) return { locked: false, retryAfterMs: 0 };

  const attempts: number[] = JSON.parse(row.value).filter((t: number) => t > windowStart);

  if (attempts.length < MAX_ATTEMPTS) return { locked: false, retryAfterMs: 0 };

  const oldestInWindow = attempts.reduce((a, b) => (b < a ? b : a));
  const retryAfterMs = Math.max(0, oldestInWindow + LOCKOUT_WINDOW_MS - now);
  return { locked: true, retryAfterMs };
}

export function clearLoginAttempts(identifier: string): void {
  const db = getDbInstance();
  const key = getKey(identifier);
  db.prepare("DELETE FROM key_value WHERE namespace = 'login_attempts' AND key = ?").run(key);
}
