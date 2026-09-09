import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { createClientRow, createOrder, createUser, tokenFor } from "../fixtures";

describe("GET /clients/:id/last-order", () => {
  it("returns null when the client has no prior orders", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();

    const res = await request(app)
      .get(`/clients/${client.id}/last-order`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("returns the most recently created order's items", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    await createOrder({
      clientId: client.id, orderNo: "SO-OLD-001",
      items: [{ description: "Old widget", qty: 1, unit_price: 10 }],
    });
    const newer = await createOrder({
      clientId: client.id, orderNo: "SO-NEW-002",
      items: [{ description: "New widget", qty: 3, unit_price: 25 }],
    });

    const res = await request(app)
      .get(`/clients/${client.id}/last-order`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.order_no).toBe(newer.order_no);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].description).toBe("New widget");
    expect(Number(res.body.items[0].qty)).toBe(3);
  });

  it("scopes to the agent's own clients — a stranger's client returns null, not another agent's data", async () => {
    const owner = await createUser({ role: "agent" });
    const stranger = await createUser({ role: "agent" });
    const client = await createClientRow({ agentId: owner.id });
    await createOrder({ clientId: client.id, items: [{ description: "X", qty: 1, unit_price: 10 }] });

    const res = await request(app)
      .get(`/clients/${client.id}/last-order`)
      .set("Authorization", `Bearer ${tokenFor(stranger)}`);

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});
