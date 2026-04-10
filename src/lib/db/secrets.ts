import { getDbInstance } from "./core";
import { encrypt, decrypt } from "./encryption";

export function getPersistedSecret(key: string): string | null {
  try {
    const db = getDbInstance();
    const row = db
      .prepare("SELECT value FROM key_value WHERE namespace = 'secrets' AND key = ?")
      .get(key) as { value: string } | undefined;
    if (!row?.value) return null;
    const raw = JSON.parse(row.value);
    return typeof raw === "string" ? (decrypt(raw) ?? null) : null;
  } catch {
    return null;
  }
}

export function persistSecret(key: string, value: string): void {
  try {
    const db = getDbInstance();
    const encrypted = encrypt(value) ?? value;
    db.prepare(
      "INSERT OR IGNORE INTO key_value (namespace, key, value) VALUES ('secrets', ?, ?)",
    ).run(key, JSON.stringify(encrypted));
  } catch {
    // Non-fatal: secrets still work for the current process if persistence fails.
  }
}
