export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // WebKit (every iPhone/iPad browser) can CANCEL the download if the object URL is
  // revoked synchronously — the fetch of the blob races the revoke. Give it a beat.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeFileName(name: string, ext: string): string {
  const base = (name || "model").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return `${base || "model"}.${ext}`;
}
