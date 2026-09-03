import { describe, expect, it } from "vitest";
import { decryptField, encryptField, isEncryptedField } from "../../src/lib/crypto";

describe("field encryption (TIN at rest)", () => {
  it("round-trips a value through encrypt then decrypt", () => {
    const plain = "123-456-789-000";
    const encrypted = encryptField(plain);
    expect(decryptField(encrypted)).toBe(plain);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const plain = "123-456-789-000";
    expect(encryptField(plain)).not.toBe(encryptField(plain));
  });

  it("tags encrypted values with the version prefix", () => {
    expect(isEncryptedField(encryptField("anything"))).toBe(true);
  });

  it("treats legacy plaintext (no prefix) as already decrypted", () => {
    const legacy = "999-000-111-000";
    expect(isEncryptedField(legacy)).toBe(false);
    expect(decryptField(legacy)).toBe(legacy);
  });
});
