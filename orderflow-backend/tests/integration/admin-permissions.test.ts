import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { createUser, tokenFor } from "../fixtures";

describe("restricted admin accounts", () => {
  it("blocks a restricted admin from Agent Accounts routes", async () => {
    const restricted = await createUser({ role: "admin", canManageAgents: false });
    const res = await request(app).get("/agents").set("Authorization", `Bearer ${tokenFor(restricted)}`);
    expect(res.status).toBe(403);
  });

  it("blocks a restricted admin from Announcements routes", async () => {
    const restricted = await createUser({ role: "admin", canManageAnnouncements: false });
    const res = await request(app).get("/announcements").set("Authorization", `Bearer ${tokenFor(restricted)}`);
    expect(res.status).toBe(403);
  });

  it("still allows a restricted admin everywhere else (e.g. the payments-due dashboard)", async () => {
    const restricted = await createUser({ role: "admin", canManageAgents: false, canManageAnnouncements: false });
    const res = await request(app).get("/dashboard/payments-due").set("Authorization", `Bearer ${tokenFor(restricted)}`);
    expect(res.status).toBe(200);
  });

  it("a full admin can create a restricted admin account", async () => {
    const fullAdmin = await createUser({ role: "admin" });
    const res = await request(app)
      .post("/agents/admins")
      .set("Authorization", `Bearer ${tokenFor(fullAdmin)}`)
      .send({
        full_name: "AR Davao",
        email: "ar@ajcb.com.ph",
        password: "a-real-password",
        can_manage_agents: false,
        can_manage_announcements: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.can_manage_agents).toBe(false);
    expect(res.body.can_manage_announcements).toBe(false);

    // And that account really is restricted, end to end.
    const login = await request(app).post("/auth/login").send({ email: "ar@ajcb.com.ph", password: "a-real-password" });
    expect(login.body.user.can_manage_agents).toBe(false);
    const blocked = await request(app).get("/agents").set("Authorization", `Bearer ${login.body.token}`);
    expect(blocked.status).toBe(403);
  });

  it("a new admin defaults to full access unless restricted", async () => {
    const fullAdmin = await createUser({ role: "admin" });
    const res = await request(app)
      .post("/agents/admins")
      .set("Authorization", `Bearer ${tokenFor(fullAdmin)}`)
      .send({ full_name: "Another Admin", email: "another@ajcb.com.ph", password: "a-real-password" });

    expect(res.body.can_manage_agents).toBe(true);
    expect(res.body.can_manage_announcements).toBe(true);
  });

  it("an admin can't change their own permissions via /agents/admins/:id", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await request(app)
      .patch(`/agents/admins/${admin.id}`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ can_manage_agents: false });

    expect(res.status).toBe(400);
  });

  it("a full admin can toggle another admin's permissions", async () => {
    const fullAdmin = await createUser({ role: "admin" });
    const other = await createUser({ role: "admin" });
    const res = await request(app)
      .patch(`/agents/admins/${other.id}`)
      .set("Authorization", `Bearer ${tokenFor(fullAdmin)}`)
      .send({ can_manage_announcements: false });

    expect(res.status).toBe(200);
    expect(res.body.can_manage_announcements).toBe(false);
  });
});
