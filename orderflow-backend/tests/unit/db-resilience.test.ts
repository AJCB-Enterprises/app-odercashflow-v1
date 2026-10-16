import { describe, expect, it, vi } from "vitest";
import { pool, waitForDatabase } from "../../src/db";

describe("database connection resilience", () => {
  it("survives a dropped connection and keeps answering queries", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => pool.emit("error", new Error("terminating connection due to administrator command"), {} as any)).not.toThrow();
    const res = await pool.query("SELECT 1 AS ok");
    expect(res.rows[0].ok).toBe(1);
    spy.mockRestore();
  });

  it("waits for the database to come up instead of giving up on the first failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const check = async () => {
      calls++;
      if (calls < 3) throw new Error("connect ECONNREFUSED");
    };
    await waitForDatabase(check, { attempts: 5, delayMs: 1 });
    expect(calls).toBe(3);
    warn.mockRestore();
  });

  it("still fails if the database never comes up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const check = async () => { throw new Error("connect ECONNREFUSED"); };
    await expect(waitForDatabase(check, { attempts: 3, delayMs: 1 })).rejects.toThrow("ECONNREFUSED");
    warn.mockRestore();
  });
});
