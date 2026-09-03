import { describe, expect, it } from "vitest";
import { clientEmails, renderTemplate } from "../../src/lib/email";

describe("clientEmails", () => {
  it("combines the primary email with extra emails", () => {
    expect(clientEmails({ email: "a@x.com", extra_emails: ["b@x.com", "c@x.com"] })).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });

  it("dedupes when an extra email repeats the primary", () => {
    expect(clientEmails({ email: "a@x.com", extra_emails: ["a@x.com", "b@x.com"] })).toEqual([
      "a@x.com",
      "b@x.com",
    ]);
  });

  it("handles a client with no extra emails", () => {
    expect(clientEmails({ email: "a@x.com" })).toEqual(["a@x.com"]);
  });
});

describe("renderTemplate", () => {
  it("substitutes known placeholders", () => {
    expect(renderTemplate("Hi {{contact}}, invoice {{invoice}} is due.", { contact: "Jam", invoice: "SI-0001" })).toBe(
      "Hi Jam, invoice SI-0001 is due."
    );
  });

  it("leaves unknown placeholders intact instead of blanking them", () => {
    expect(renderTemplate("Hi {{contact}}, {{unknown}} placeholder.", { contact: "Jam" })).toBe(
      "Hi Jam, {{unknown}} placeholder."
    );
  });
});
