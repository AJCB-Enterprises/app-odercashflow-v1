import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { createClientRow, createOrder, createUser, tokenFor } from "../fixtures";

describe("POST /orders — discount_amount", () => {
  it("nets the discount off the invoice amount when approved", async () => {
    const agent = await createUser({ role: "agent" });
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ agentId: agent.id });

    const created = await request(app)
      .post("/orders")
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .field("client_id", client.id)
      .field("items", JSON.stringify([{ description: "Widget", qty: 10, unit_price: 100 }]))
      .field("discount_amount", "150");
    expect(created.status).toBe(201);
    expect(Number(created.body.discount_amount)).toBe(150);

    const approved = await request(app)
      .post(`/orders/${created.body.id}/approve`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ invoice_no: `SI-DISC-${Date.now()}` });

    expect(approved.status).toBe(200);
    expect(Number(approved.body.invoice.amount)).toBe(850); // 1000 - 150
  });

  it("rejects a discount larger than the item subtotal", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow({ agentId: agent.id });

    const res = await request(app)
      .post("/orders")
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .field("client_id", client.id)
      .field("items", JSON.stringify([{ description: "Widget", qty: 1, unit_price: 100 }]))
      .field("discount_amount", "200");

    expect(res.status).toBe(400);
  });

  it("defaults to no discount when omitted", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow({ agentId: agent.id });

    const res = await request(app)
      .post("/orders")
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .field("client_id", client.id)
      .field("items", JSON.stringify([{ description: "Widget", qty: 1, unit_price: 100 }]));

    expect(res.status).toBe(201);
    expect(Number(res.body.discount_amount)).toBe(0);
  });
});

describe("PATCH /orders/:id — discount_amount", () => {
  it("keeps the existing discount when the field is omitted on revision", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow({ agentId: agent.id });
    const order = await createOrder({
      clientId: client.id, status: "pending",
      items: [{ description: "A", qty: 1, unit_price: 100 }],
      discountAmount: 10,
    });

    const res = await request(app)
      .patch(`/orders/${order.id}`)
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .field("items", JSON.stringify([{ description: "A", qty: 1, unit_price: 100 }]));

    expect(res.status).toBe(200);
    expect(Number(res.body.discount_amount)).toBe(10);
  });

  it("rejects a revised discount that no longer fits the (possibly lowered) new subtotal", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow({ agentId: agent.id });
    const order = await createOrder({
      clientId: client.id, status: "pending",
      items: [{ description: "A", qty: 1, unit_price: 100 }],
      discountAmount: 50,
    });

    const res = await request(app)
      .patch(`/orders/${order.id}`)
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .field("items", JSON.stringify([{ description: "A", qty: 1, unit_price: 20 }]));

    expect(res.status).toBe(400);
  });

  it("updates the discount when a new value is sent", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow({ agentId: agent.id });
    const order = await createOrder({
      clientId: client.id, status: "pending",
      items: [{ description: "A", qty: 1, unit_price: 100 }],
      discountAmount: 10,
    });

    const res = await request(app)
      .patch(`/orders/${order.id}`)
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .field("items", JSON.stringify([{ description: "A", qty: 1, unit_price: 100 }]))
      .field("discount_amount", "30");

    expect(res.status).toBe(200);
    expect(Number(res.body.discount_amount)).toBe(30);
  });
});
