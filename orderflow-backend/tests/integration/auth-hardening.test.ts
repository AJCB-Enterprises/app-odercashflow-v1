import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { app } from "../../src/app";
import { config } from "../../src/config";
import { createUser } from "../fixtures";

const login = (email: string, password: string) => request(app).post("/auth/login").send({ email, password });
const me = (token: string) => request(app).get("/notifications").set("Authorization", `Bearer ${token}`);

describe("sign-in hardening", () => {
  it("locks an account's sign-in after 10 failed attempts, even for the right password", async () => {
    await createUser({ role: "agent", email: "lock-target@test.com", password: "correct-password" });
    for (let i = 0; i < 10; i++) expect((await login("lock-target@test.com", "wrong")).status).toBe(401);

    const blocked = await login("lock-target@test.com", "wrong");
    expect(blocked.status).toBe(429);
    expect((await login("lock-target@test.com", "correct-password")).status).toBe(429);
    // Another account is unaffected.
    await createUser({ role: "agent", email: "other@test.com", password: "correct-password" });
    expect((await login("other@test.com", "correct-password")).status).toBe(200);
  });

  it("still checks a password for an unknown email, so response time can't reveal which emails exist", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    await login("nobody-here@test.com", "whatever");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("tokens", () => {
  it("are retired when the password changes, and the session gets a fresh one", async () => {
    await createUser({ role: "agent", email: "changer@test.com", password: "old-password-123" });
    const first = await login("changer@test.com", "old-password-123");
    const oldToken = first.body.token;
    expect((await me(oldToken)).status).toBe(200);

    const changed = await request(app)
      .patch("/auth/password")
      .set("Authorization", `Bearer ${oldToken}`)
      .send({ current_password: "old-password-123", new_password: "brand-new-password-456" });
    expect(changed.status).toBe(200);
    const newToken = changed.body.token;

    expect((await me(oldToken)).status).toBe(401);
    expect((await me(newToken)).status).toBe(200);
    expect((await login("changer@test.com", "brand-new-password-456")).status).toBe(200);
  });

  it("report a wrong current password as 400, so the app doesn't treat it as an expired session", async () => {
    await createUser({ role: "agent", email: "typo@test.com", password: "right-password-123" });
    const token = (await login("typo@test.com", "right-password-123")).body.token;
    const res = await request(app)
      .patch("/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ current_password: "wrong-one", new_password: "another-new-password-1" });
    expect(res.status).toBe(400);
    expect((await me(token)).status).toBe(200);
  });

  it("must be signed with HS256 — a validly signed token using another algorithm is refused", async () => {
    const user = await createUser({ role: "agent" });
    const hs512 = jwt.sign({ sub: user.id, role: "agent" }, config.jwtSecret, { algorithm: "HS512" });
    const hs256 = jwt.sign({ sub: user.id, role: "agent" }, config.jwtSecret, { algorithm: "HS256" });
    expect((await me(hs512)).status).toBe(401);
    expect((await me(hs256)).status).toBe(200);
  });
});
