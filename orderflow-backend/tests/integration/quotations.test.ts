import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import { createClientRow, createUser, tokenFor } from "../fixtures";

const body = (clientId: string, overrides: Record<string, any> = {}) => ({
  client_id: clientId,
  items: [
    { description: "Widget", qty: 10, unit_price: 100 },
    { description: "Gadget", qty: 2, unit_price: 250 },
  ],
  payment_terms: "net_30",
  vat_status: "vat_inclusive",
  valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  ...overrides,
});

describe("POST /quotations", () => {
  it("creates a quotation and reports it as sent", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow({ agentId: agent.id });

    const res = await request(app)
      .post("/quotations")
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .send(body(client.id));

    expect(res.status).toBe(201);
    expect(res.body.quote_no).toMatch(/^QT-\d{4}-\d{4}$/);
    expect(res.body.sent).toBe(true);
    expect(res.body.sent_at).not.toBeNull();

    const { rows } = await pool.query("SELECT * FROM quotation_items WHERE quotation_id = $1", [res.body.id]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.description).sort()).toEqual(["Gadget", "Widget"]);
  });

  it("lets admin quote for any client", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();

    const res = await request(app)
      .post("/quotations")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send(body(client.id));

    expect(res.status).toBe(201);
  });

  it("blocks a client with no email on file", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow({ agentId: agent.id, email: null });

    const res = await request(app)
      .post("/quotations")
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .send(body(client.id));

    expect(res.status).toBe(400);
  });

  it("404s when an agent quotes for a client that isn't theirs", async () => {
    const owner = await createUser({ role: "agent" });
    const stranger = await createUser({ role: "agent" });
    const client = await createClientRow({ agentId: owner.id });

    const res = await request(app)
      .post("/quotations")
      .set("Authorization", `Bearer ${tokenFor(stranger)}`)
      .send(body(client.id));

    expect(res.status).toBe(404);
  });

  it("requires at least one item", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow({ agentId: agent.id });

    const res = await request(app)
      .post("/quotations")
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .send(body(client.id, { items: [] }));

    expect(res.status).toBe(400);
  });

  it("is blocked for an agent without can_create_po", async () => {
    const agent = await createUser({ role: "agent", canCreatePo: false });
    const client = await createClientRow({ agentId: agent.id });

    const res = await request(app)
      .post("/quotations")
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .send(body(client.id));

    expect(res.status).toBe(403);
  });
});

describe("GET /quotations", () => {
  it("an agent only sees quotations for their own clients", async () => {
    const agent = await createUser({ role: "agent" });
    const other = await createUser({ role: "agent" });
    const own = await createClientRow({ agentId: agent.id });
    const notOwn = await createClientRow({ agentId: other.id });

    await request(app).post("/quotations").set("Authorization", `Bearer ${tokenFor(agent)}`).send(body(own.id));
    await request(app).post("/quotations").set("Authorization", `Bearer ${tokenFor(other)}`).send(body(notOwn.id));

    const res = await request(app).get("/quotations").set("Authorization", `Bearer ${tokenFor(agent)}`);

    expect(res.status).toBe(200);
    const clientIds = res.body.map((qt: any) => qt.client_id);
    expect(clientIds).toContain(own.id);
    expect(clientIds).not.toContain(notOwn.id);
  });

  it("admin sees every quotation, with totals and items", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow({ agentId: agent.id });
    await request(app).post("/quotations").set("Authorization", `Bearer ${tokenFor(agent)}`).send(body(client.id));

    const admin = await createUser({ role: "admin" });
    const res = await request(app).get("/quotations").set("Authorization", `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(Number(res.body[0].total)).toBe(1500); // 10*100 + 2*250
    expect(res.body[0].items).toHaveLength(2);
  });
});
