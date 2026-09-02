import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config";

/**
 * Local-disk storage with an S3-shaped interface. In production, replace the
 * bodies of save/read with S3 PutObject / presigned GetObject calls — callers
 * only ever see opaque storage keys, so nothing else changes.
 */

const root = path.resolve(config.uploadDir);

const safePath = (key: string) => {
  const p = path.resolve(root, key);
  if (!p.startsWith(root + path.sep)) throw new Error("Invalid storage key");
  return p;
};

export const saveReceipt = async (invoiceId: string, ext: string, data: Buffer): Promise<string> => {
  const key = path.join(invoiceId, `${crypto.randomUUID()}.${ext}`);
  const full = safePath(key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, data);
  return key;
};

export const readReceipt = async (key: string): Promise<Buffer> => fs.promises.readFile(safePath(key));

/** BIR Form 2307 (EWT), optionally uploaded alongside a payment receipt. */
export const saveEwtForm = async (invoiceId: string, ext: string, data: Buffer): Promise<string> => {
  const key = path.join(invoiceId, `ewt-${crypto.randomUUID()}.${ext}`);
  const full = safePath(key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, data);
  return key;
};

export const readEwtForm = async (key: string): Promise<Buffer> => fs.promises.readFile(safePath(key));

export const saveOrderAttachment = async (orderId: string, ext: string, data: Buffer): Promise<string> => {
  const key = path.join("orders", orderId, `${crypto.randomUUID()}.${ext}`);
  const full = safePath(key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, data);
  return key;
};

export const readOrderAttachment = async (key: string): Promise<Buffer> => fs.promises.readFile(safePath(key));

/** docType is a fixed key like "bir_cor" or "peza_cert" — never user-supplied free text. */
export const saveClientDocument = async (
  clientId: string,
  docType: string,
  ext: string,
  data: Buffer
): Promise<string> => {
  const key = path.join("clients", clientId, `${docType}-${crypto.randomUUID()}.${ext}`);
  const full = safePath(key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, data);
  return key;
};

export const readClientDocument = async (key: string): Promise<Buffer> => fs.promises.readFile(safePath(key));

/** Magic-byte sniffing — trust file contents, not the client's Content-Type. */
export const sniffFileType = (buf: Buffer): { ext: string; mime: string } | null => {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { ext: "jpg", mime: "image/jpeg" };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { ext: "png", mime: "image/png" };
  if (buf.length > 4 && buf.subarray(0, 5).toString("latin1") === "%PDF-")
    return { ext: "pdf", mime: "application/pdf" };
  return null;
};

const ALLOWED_TYPES: Record<string, { mimes: string[]; exts: string[] }> = {
  jpg: { mimes: ["image/jpeg", "image/jpg"], exts: ["jpg", "jpeg"] },
  png: { mimes: ["image/png"], exts: ["png"] },
  pdf: { mimes: ["application/pdf"], exts: ["pdf"] },
};

/**
 * Full upload validation: the declared Content-Type, the filename extension,
 * and the actual file bytes must all agree on the same type (JPG/PNG/PDF).
 * Any mismatch — a relabeled file, a spoofed Content-Type, a lying extension
 * — is rejected. The returned {ext, mime} come from the sniffed content,
 * since that's the only one of the three the client can't fake.
 */
export const validateUpload = (file: {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
}): { ext: string; mime: string } | null => {
  const sniffed = sniffFileType(file.buffer);
  if (!sniffed) return null;
  const rule = ALLOWED_TYPES[sniffed.ext];

  const declaredMime = (file.mimetype || "").toLowerCase().trim();
  if (!rule.mimes.includes(declaredMime)) return null;

  const nameExt = (file.originalname || "").split(".").pop()?.toLowerCase().trim() || "";
  if (!rule.exts.includes(nameExt)) return null;

  return sniffed;
};

/**
 * The client-supplied filename is only ever used as a display label (stored
 * storage keys are always a generated UUID, never this) — but it's echoed
 * back verbatim in a Content-Disposition header, so it's sanitized down to a
 * safe printable subset first. Strips path separators, control/CR-LF
 * characters, and quotes that could otherwise break the header or mislead a
 * user with a spoofed name.
 */
export const sanitizeFilename = (name: string | undefined, fallback: string): string => {
  const cleaned = (name || "")
    .replace(/[^A-Za-z0-9 ._-]/g, "_")
    .replace(/_+/g, "_")
    .trim();
  return (cleaned || fallback).slice(0, 200);
};
