import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import { createClientRow, createOrder, createUser, tokenFor } from "../fixtures";

const get = (token: string, path: string) => request(app).get(path).set("Authorization", `Bearer ${token}`);
const setTarget = (token: string, body: object) => request(app).put("/sales/targets").set("Authorization", `Bearer ${token}`).send(body);

const worth = (n: number) => [{ description: "Item", qty: 1, unit_price: n }];

describe("GET /sales/summary", () => {
  it("counts approved orders as achieved, pending separately, and nothing else", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent", fullName: "Alice" });
    const other = await createUser({ role: "agent", fullName: "Bob" });
    const client = await createClientRow();
    const at = "2026-10-10T04:00:00Z";
    const mk = (status: any, amount: number, by = agent.id, discountAmount = 0) =>
      createOrder({ clientId: client.id, status, items: worth(amount), createdBy: by, createdAt: at, discountAmount });

    await mk("approved", 1000);
    await mk("approved", 500, agent.id, 100); // nets its own discount: 400
    await mk("pending", 300);
    await mk("rejected", 999);
    await mk("cancelled", 888);
    await mk("approved", 7777, other.id); // someone else's

    const res = await get(tokenFor(admin), "/sales/summary?month=2026-10");
    expect(res.status).toBe(200);
    const alice = res.body.agents.find((a: any) => a.agent_id === agent.id);
    expect(Number(alice.achieved)).toBe(1400);
    expect(alice.approved_count).toBe(2);
    expect(Number(alice.pending_amount)).toBe(300);
    expect(alice.pending_count).toBe(1);
    expect(Number(res.body.agents.find((a: any) => a.agent_id === other.id).achieved)).toBe(7777);
  });

  it("assigns an order to a month by its date in Manila, not UTC", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow();
    const mk = (createdAt: string, amount: number) =>
      createOrder({ clientId: client.id, status: "approved", items: worth(amount), createdBy: agent.id, createdAt });
    await mk("2026-09-30T17:00:00Z", 100); // Oct 1, 01:00 in Manila -> October
    await mk("2026-10-31T16:30:00Z", 200); // Nov 1, 00:30 in Manila -> November
    await mk("2026-10-15T00:00:00Z", 400);

    const oct = await get(tokenFor(admin), "/sales/summary?month=2026-10");
    const nov = await get(tokenFor(admin), "/sales/summary?month=2026-11");
    expect(Number(oct.body.agents.find((a: any) => a.agent_id === agent.id).achieved)).toBe(500);
    expect(Number(nov.body.agents.find((a: any) => a.agent_id === agent.id).achieved)).toBe(200);
  });

  it("shows an agent only themselves, and hides an inactive agent with no orders that month", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent" });
    const other = await createUser({ role: "agent" });
    const inactive = await createUser({ role: "agent" });
    await pool.query("UPDATE users SET is_active = false WHERE id = $1", [inactive.id]);

    const own = await get(tokenFor(agent), "/sales/summary?month=2026-10");
    expect(own.body.agents.map((a: any) => a.agent_id)).toEqual([agent.id]);

    const all = await get(tokenFor(admin), "/sales/summary?month=2026-10");
    const ids = all.body.agents.map((a: any) => a.agent_id);
    expect(ids).toContain(agent.id);
    expect(ids).toContain(other.id);
    expect(ids).not.toContain(inactive.id);
  });

  it("rejects a malformed month and defaults to the current month", async () => {
    const admin = await createUser({ role: "admin" });
    expect((await get(tokenFor(admin), "/sales/summary?month=October")).status).toBe(400);
    const now = await get(tokenFor(admin), "/sales/summary");
    expect(now.body.month).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("sales targets", () => {
  it("carries a target forward until a later month changes it, and 0 clears it", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent" });
    const token = tokenFor(admin);
    const target = async (month: string) => {
      const r = await get(token, `/sales/summary?month=${month}`);
      return r.body.agents.find((a: any) => a.agent_id === agent.id);
    };

    expect((await target("2026-10")).target).toBeNull();

    expect((await setTarget(token, { agent_id: agent.id, month: "2026-09", target_amount: 100000 })).status).toBe(200);
    expect(Number((await target("2026-10")).target)).toBe(100000);
    expect((await target("2026-10")).target_from).toBe("2026-09");
    expect((await target("2026-08")).target).toBeNull(); // before it was set

    await setTarget(token, { agent_id: agent.id, month: "2026-10", target_amount: 150000 });
    expect(Number((await target("2026-10")).target)).toBe(150000);
    expect(Number((await target("2026-09")).target)).toBe(100000);
    expect(Number((await target("2026-12")).target)).toBe(150000);

    await setTarget(token, { agent_id: agent.id, month: "2026-11", target_amount: 0 });
    expect((await target("2026-11")).target).toBeNull();
    expect((await target("2026-12")).target).toBeNull();
    expect(Number((await target("2026-10")).target)).toBe(150000);
  });

  it("is limited to admins with can_manage_agents, and validates its input", async () => {
    const admin = await createUser({ role: "admin" });
    const restricted = await createUser({ role: "admin", canManageAgents: false });
    const agent = await createUser({ role: "agent" });
    const body = { agent_id: agent.id, month: "2026-10", target_amount: 5000 };

    expect((await setTarget(tokenFor(agent), body)).status).toBe(403);
    expect((await setTarget(tokenFor(restricted), body)).status).toBe(403);
    expect((await setTarget(tokenFor(admin), { ...body, month: "2026-13" })).status).toBe(400);
    expect((await setTarget(tokenFor(admin), { ...body, target_amount: -1 })).status).toBe(400);
    expect((await setTarget(tokenFor(admin), { ...body, agent_id: admin.id })).status).toBe(404); // not an agent
    expect((await setTarget(tokenFor(admin), body)).status).toBe(200);
  });
});

describe("GET /sales/agent/:id", () => {
  it("returns the month's orders and a six-month history, and keeps agents out of each other's", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent" });
    const other = await createUser({ role: "agent" });
    const client = await createClientRow({ companyName: "Acme" });
    const mk = (createdAt: string, amount: number, status: any = "approved") =>
      createOrder({ clientId: client.id, status, items: worth(amount), createdBy: agent.id, createdAt });
    await mk("2026-10-05T04:00:00Z", 1000);
    await mk("2026-10-20T04:00:00Z", 250, "pending");
    await mk("2026-08-12T04:00:00Z", 600);
    await mk("2026-03-12T04:00:00Z", 9999); // outside the six-month window
    await setTarget(tokenFor(admin), { agent_id: agent.id, month: "2026-08", target_amount: 2000 });

    const res = await get(tokenFor(agent), `/sales/agent/${agent.id}?month=2026-10`);
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(2);
    expect(res.body.orders[0].company_name).toBe("Acme");
    expect(Number(res.body.summary.achieved)).toBe(1000);
    expect(Number(res.body.summary.pending_amount)).toBe(250);

    expect(res.body.history.map((h: any) => h.month)).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
    const byMonth = Object.fromEntries(res.body.history.map((h: any) => [h.month, h]));
    expect(Number(byMonth["2026-10"].achieved)).toBe(1000);
    expect(Number(byMonth["2026-08"].achieved)).toBe(600);
    expect(Number(byMonth["2026-09"].achieved)).toBe(0);
    expect(Number(byMonth["2026-10"].target)).toBe(2000); // carried forward from August
    expect(byMonth["2026-05"].target).toBeNull();

    expect((await get(tokenFor(other), `/sales/agent/${agent.id}?month=2026-10`)).status).toBe(403);
    expect((await get(tokenFor(admin), `/sales/agent/${agent.id}?month=2026-10`)).status).toBe(200);
  });

  it("404s for an unknown agent", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await get(tokenFor(admin), `/sales/agent/${admin.id}?month=2026-10`);
    expect(res.status).toBe(404);
  });
});

describe("orders an admin logged on an agent's behalf", () => {
  it("count for the client's assigned agent, not the admin", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent", fullName: "Alice" });
    const other = await createUser({ role: "agent", fullName: "Bob" });
    const mine = await createClientRow({ agentId: agent.id, companyName: "Mine Co" });
    const theirs = await createClientRow({ agentId: other.id });
    const at = "2026-10-10T04:00:00Z";

    await createOrder({ clientId: mine.id, status: "approved", items: worth(1000), createdBy: admin.id, createdAt: at });
    await createOrder({ clientId: mine.id, status: "pending", items: worth(300), createdBy: admin.id, createdAt: at });
    await createOrder({ clientId: mine.id, status: "approved", items: worth(500), createdBy: agent.id, createdAt: at });
    await createOrder({ clientId: theirs.id, status: "approved", items: worth(7000), createdBy: admin.id, createdAt: at });

    const res = await get(tokenFor(admin), "/sales/summary?month=2026-10");
    const row = (id: string) => res.body.agents.find((a: any) => a.agent_id === id);
    expect(Number(row(agent.id).achieved)).toBe(1500);
    expect(Number(row(agent.id).pending_amount)).toBe(300);
    expect(Number(row(other.id).achieved)).toBe(7000);

    const detail = await get(tokenFor(agent), `/sales/agent/${agent.id}?month=2026-10`);
    expect(detail.body.orders).toHaveLength(3);
    expect(detail.body.orders.filter((o: any) => o.logged_by_admin)).toHaveLength(2);
    const oct = detail.body.history.find((h: any) => h.month === "2026-10");
    expect(Number(oct.achieved)).toBe(1500);
  });

  it("still counts an agent's own order even if the client isn't assigned to them", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent" });
    const unassigned = await createClientRow();
    await createOrder({ clientId: unassigned.id, status: "approved", items: worth(800), createdBy: agent.id, createdAt: "2026-10-10T04:00:00Z" });

    const res = await get(tokenFor(admin), "/sales/summary?month=2026-10");
    expect(Number(res.body.agents.find((a: any) => a.agent_id === agent.id).achieved)).toBe(800);
  });
});

