import crypto from "node:crypto";
import { config } from "../config";

/**
 * AES-256-GCM field encryption for at-rest-sensitive columns (currently just
 * client TIN, which the Philippines' Data Privacy Act treats as sensitive
 * personal information). Ciphertext carries a version prefix so decrypt()
 * can tell an encrypted value from a legacy plaintext one during the
 * one-time backfill in migrate.ts.
 */
const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";

const key = (() => {
  const buf = Buffer.from(config.tinEncryptionKey, "base64");
  if (buf.length !== 32) throw new Error("TIN_ENCRYPTION_KEY must decode to 32 bytes (base64)");
  return buf;
})();

export const isEncryptedField = (value: string): boolean => value.startsWith(PREFIX);

export const encryptField = (plaintext: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
};

/** Legacy plaintext values (pre-backfill) pass through unchanged. */
export const decryptField = (value: string): string => {
  if (!isEncryptedField(value)) return value;
  const raw = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
};
