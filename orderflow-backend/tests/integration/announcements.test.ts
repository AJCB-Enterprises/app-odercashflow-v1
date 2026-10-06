import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import * as emailLib from "../../src/lib/email";
import { createClientRow, createUser, tokenFor } from "../fixtures";

describe("POST /announcements", () => {
  it("counts sent, no-email and failed clients separately, and records them", async () => {
    const admin = await createUser({ role: "admin" });
    await createClientRow({ email: "ok@example.com" });
    await createClientRow({ email: "ok2@example.com" });
    await createClientRow({ email: null });
    await createClientRow({ email: null });
    await createClientRow({ email: null });
    await createClientRow({ email: "bounce@example.com" });

    const spy = vi.spyOn(emailLib, "sendMail").mockImplementation(async (to) => {
      if (String(to).includes("bounce@")) throw new Error("rejected");
      return { providerId: "test" };
    });
    const res = await request(app)
      .post("/announcements")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ subject: "Hello", body: "Hi {{contact}}" });
    spy.mockRestore();

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ attempted: 6, sent: 2, no_email: 3, failed: 1 });
    expect(res.body).toMatchObject({ recipient_count: 2, no_email_count: 3, failed_count: 1 });

    const list = await request(app).get("/announcements").set("Authorization", `Bearer ${tokenFor(admin)}`);
    expect(list.body[0]).toMatchObject({ subject: "Hello", recipient_count: 2, no_email_count: 3, failed_count: 1 });
  });

  it("counts a client with only extra emails as sendable", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ email: null });
    const { pool } = await import("../../src/db");
    await pool.query("UPDATE clients SET extra_emails = $2 WHERE id = $1", [client.id, ["extra@example.com"]]);

    const spy = vi.spyOn(emailLib, "sendMail").mockResolvedValue({ providerId: "test" });
    const res = await request(app)
      .post("/announcements")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ subject: "Hello", body: "Hi" });
    spy.mockRestore();

    expect(res.body).toMatchObject({ sent: 1, no_email: 0, failed: 0 });
  });

  it("rejects a blank subject and requires the announcements permission", async () => {
    const admin = await createUser({ role: "admin" });
    const restricted = await createUser({ role: "admin", canManageAnnouncements: false });
    await createClientRow();

    const blank = await request(app).post("/announcements").set("Authorization", `Bearer ${tokenFor(admin)}`).send({ subject: " ", body: "x" });
    expect(blank.status).toBe(400);
    const denied = await request(app).post("/announcements").set("Authorization", `Bearer ${tokenFor(restricted)}`).send({ subject: "a", body: "b" });
    expect(denied.status).toBe(403);
  });
});
