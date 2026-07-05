// Encrypted settings backup — move keys & settings to another computer without
// any server or account. AES-GCM, key derived from the user's passphrase via
// PBKDF2 (310k iterations, SHA-256). The file is useless without the passphrase.

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const mat = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 310_000, hash: "SHA-256" },
    mat,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Everything the app stores in localStorage (keys, providers, printer, units…). */
export function gatherSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith("moldable_")) out[k] = localStorage.getItem(k)!;
  }
  return out;
}

/** Encrypt any string into a self-describing envelope (also used by cloud sync). */
export async function encryptPayload(passphrase: string, plaintext: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(plaintext)));
  return JSON.stringify({ app: "moldable-settings", v: 1, salt: b64(salt), iv: b64(iv), data: b64(ct) });
}

/** Decrypt an envelope produced by encryptPayload. Throws on wrong passphrase. */
export async function decryptPayload(passphrase: string, envelope: string): Promise<string> {
  let payload: any;
  try {
    payload = JSON.parse(envelope);
  } catch {
    throw new Error("That isn't a Moldable backup.");
  }
  if (payload?.app !== "moldable-settings" || !payload.salt || !payload.iv || !payload.data) {
    throw new Error("That isn't a Moldable backup.");
  }
  const key = await deriveKey(passphrase, unb64(payload.salt));
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(payload.iv) as BufferSource }, key, unb64(payload.data) as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Wrong passphrase for this backup.");
  }
}

export async function exportSettings(passphrase: string): Promise<Blob> {
  const envelope = await encryptPayload(passphrase, JSON.stringify(gatherSettings()));
  return new Blob([envelope], { type: "application/json" });
}

/** Returns the number of restored settings. Throws on wrong passphrase / bad file. */
export async function importSettings(file: Blob, passphrase: string): Promise<number> {
  const data = JSON.parse(await decryptPayload(passphrase, await file.text())) as Record<string, string>;
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith("moldable_")) {
      localStorage.setItem(k, v);
      n++;
    }
  }
  return n;
}
