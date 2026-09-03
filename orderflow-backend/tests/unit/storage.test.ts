import { describe, expect, it } from "vitest";
import { sanitizeFilename, sniffFileType, validateUpload } from "../../src/lib/storage";

const jpegBytes = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]);
const pngBytes = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const pdfBytes = () => Buffer.from("%PDF-1.4\n...");
const textBytes = () => Buffer.from("just some plain text, not a real file");

describe("sniffFileType", () => {
  it("recognizes JPEG magic bytes", () => {
    expect(sniffFileType(jpegBytes())).toEqual({ ext: "jpg", mime: "image/jpeg" });
  });
  it("recognizes PNG magic bytes", () => {
    expect(sniffFileType(pngBytes())).toEqual({ ext: "png", mime: "image/png" });
  });
  it("recognizes PDF magic bytes", () => {
    expect(sniffFileType(pdfBytes())).toEqual({ ext: "pdf", mime: "application/pdf" });
  });
  it("rejects content that isn't any of the three", () => {
    expect(sniffFileType(textBytes())).toBeNull();
  });
});

describe("validateUpload", () => {
  it("accepts a JPEG whose declared mimetype and filename extension agree with its bytes", () => {
    const result = validateUpload({ buffer: jpegBytes(), mimetype: "image/jpeg", originalname: "receipt.jpg" });
    expect(result).toEqual({ ext: "jpg", mime: "image/jpeg" });
  });

  it("rejects a file relabeled with the wrong extension", () => {
    // Real bytes are a PNG, but the filename claims .pdf — a spoofing attempt.
    const result = validateUpload({ buffer: pngBytes(), mimetype: "image/png", originalname: "fake.pdf" });
    expect(result).toBeNull();
  });

  it("rejects a spoofed Content-Type that doesn't match the real bytes", () => {
    // Real bytes are a JPEG, but the client claims it's a PDF.
    const result = validateUpload({ buffer: jpegBytes(), mimetype: "application/pdf", originalname: "receipt.jpg" });
    expect(result).toBeNull();
  });

  it("rejects content that isn't JPG/PNG/PDF at all, regardless of claimed type", () => {
    const result = validateUpload({ buffer: textBytes(), mimetype: "image/jpeg", originalname: "receipt.jpg" });
    expect(result).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it("passes through an already-safe name", () => {
    expect(sanitizeFilename("receipt-2026.jpg", "fallback.jpg")).toBe("receipt-2026.jpg");
  });

  it("strips control characters, quotes, and path separators", () => {
    const evil = 'evil"\r\n/../name.jpg';
    const cleaned = sanitizeFilename(evil, "fallback.jpg");
    expect(cleaned).not.toMatch(/["\r\n/]/);
  });

  it("falls back when the name is empty", () => {
    expect(sanitizeFilename("", "fallback.jpg")).toBe("fallback.jpg");
    expect(sanitizeFilename(undefined, "fallback.jpg")).toBe("fallback.jpg");
  });

  it("truncates a name longer than 200 characters", () => {
    const long = "a".repeat(300) + ".jpg";
    expect(sanitizeFilename(long, "fallback.jpg").length).toBeLessThanOrEqual(200);
  });
});
