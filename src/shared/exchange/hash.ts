/** SHA-256 内容哈希，作为资源与作品的唯一身份。 */

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function contentHash(bytes: Uint8Array): Promise<string> {
  return "sha256:" + (await sha256Hex(bytes));
}

export const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function isContentHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}
