/** multipart/form-data body built by hand (pure, testable). */
export function multipartBody(
  fields: [string, string][],
  files: { name: string; filename: string; data: Uint8Array; type?: string }[],
  boundary = `----EbookBoundary${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
): { body: Uint8Array; contentType: string } {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [name, value] of fields) {
    parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const f of files) {
    parts.push(
      enc.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.type ?? 'image/jpeg'}\r\n\r\n`,
      ),
    );
    parts.push(f.data);
    parts.push(enc.encode('\r\n'));
  }
  parts.push(enc.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    body.set(p, o);
    o += p.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
