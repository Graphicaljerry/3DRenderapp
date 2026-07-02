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
function gatherSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith("moldable_")) out[k] = localStorage.getItem(k)!;
  }
  return out;
}

export async function exportSettings(passphrase: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plain = new TextEncoder().encode(JSON.stringify(gatherSettings()));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plain));
  const payload = { app: "moldable-settings", v: 1, salt: b64(salt), iv: b64(iv), data: b64(ct) };
  return new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
}

/** Returns the number of restored settings. Throws on wrong passphrase / bad file. */
export async function importSettings(file: Blob, passphrase: string): Promise<number> {
  let payload: any;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't a Moldable backup.");
  }
  if (payload?.app !== "moldable-settings" || !payload.salt || !payload.iv || !payload.data) {
    throw new Error("That file isn't a Moldable backup.");
  }
  const key = await deriveKey(passphrase, unb64(payload.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(payload.iv) as BufferSource }, key, unb64(payload.data) as BufferSource);
  } catch {
    throw new Error("Wrong passphrase for this backup.");
  }
  const data = JSON.parse(new TextDecoder().decode(plain)) as Record<string, string>;
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith("moldable_")) {
      localStorage.setItem(k, v);
      n++;
    }
  }
  return n;
}
