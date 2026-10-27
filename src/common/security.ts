import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyBytes(key: string): Buffer {
  const bytes = Buffer.from(key, "base64");
  if (bytes.length !== 32)
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    );
  return bytes;
}

export function encrypt(value: unknown, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decrypt<T>(value: string, key: string): T {
  const [version, iv, tag, ciphertext, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra)
    throw new Error("Invalid encrypted token");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes(key),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  ) as T;
}
