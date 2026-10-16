import { describe, expect, it } from "vitest";
import { startupWarnings } from "../../src/lib/startup-checks";

const good = { jwtSecret: "x".repeat(40), corsOrigin: "https://app.example.com", resendApiKey: "re_abc", smtpUrl: "" };

describe("startupWarnings", () => {
  it("is quiet for a sound configuration", () => {
    expect(startupWarnings(good)).toEqual([]);
  });

  it("flags a short JWT secret, an open CORS setting, and no email provider", () => {
    const warnings = startupWarnings({ jwtSecret: "short", corsOrigin: "*", resendApiKey: "", smtpUrl: "" });
    expect(warnings).toHaveLength(3);
    expect(warnings.join(" ")).toMatch(/JWT_SECRET/);
    expect(warnings.join(" ")).toMatch(/CORS_ORIGIN/);
    expect(warnings.join(" ")).toMatch(/email provider/);
  });

  it("accepts SMTP as the email provider", () => {
    expect(startupWarnings({ ...good, resendApiKey: "", smtpUrl: "smtp://host" })).toEqual([]);
  });
});
