import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { createUser } from "../fixtures";

describe("POST /auth/login", () => {
  it("issues a token for correct credentials", async () => {
    await createUser({ role: "admin", email: "admin@test.com", password: "correct-password" });

    const res = await request(app).post("/auth/login").send({ email: "admin@test.com", password: "correct-password" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.user.role).toBe("admin");
  });

  it("rejects a wrong password with a generic message", async () => {
    await createUser({ role: "admin", email: "admin2@test.com", password: "correct-password" });

    const res = await request(app).post("/auth/login").send({ email: "admin2@test.com", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("rejects an unknown email with the same generic message (no account enumeration)", async () => {
    const res = await request(app).post("/auth/login").send({ email: "nobody@test.com", password: "whatever" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("rejects a deactivated account even with the right password", async () => {
    const user = await createUser({ role: "agent", email: "inactive@test.com", password: "correct-password" });
    const { pool } = await import("../../src/db");
    await pool.query("UPDATE users SET is_active = false WHERE id = $1", [user.id]);

    const res = await request(app).post("/auth/login").send({ email: "inactive@test.com", password: "correct-password" });
    expect(res.status).toBe(401);
  });
});

describe("routes requiring auth", () => {
  it("rejects requests with no token", async () => {
    const res = await request(app).get("/clients");
    expect(res.status).toBe(401);
  });

  it("rejects requests with a garbage token", async () => {
    const res = await request(app).get("/clients").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });
});
