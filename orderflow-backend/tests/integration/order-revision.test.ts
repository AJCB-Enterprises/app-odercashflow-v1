import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import { createClientRow, createInvoice, createOrder, createUser, tokenFor } from "../fixtures";

describe("POST /orders/:id/reassign-client", () => {
  it("moves both the order and its direct invoice to the new client", async () => {
    const admin = await createUser({ role: "admin" });
    const oldClient = await createClientRow();
    const newClient = await createClientRow();
    const order = await createOrder({ clientId: oldClient.id, status: "approved" });
    await createInvoice({ clientId: oldClient.id, amount: 500, orderId: order.id });

    const res = await request(app)
      .post(`/orders/${order.id}/reassign-client`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ client_id: newClient.id });

    expect(res.status).toBe(200);
    expect(res.body.order.client_id).toBe(newClient.id);
    expect(res.body.invoice.client_id).toBe(newClient.id);

    const { rows } = await pool.query("SELECT client_id FROM orders WHERE id = $1", [order.id]);
    expect(rows[0].client_id).toBe(newClient.id);
  });

  it("moves an order with no invoice (consolidated-invoicing client, not yet consolidated)", async () => {
    const admin = await createUser({ role: "admin" });
    const oldClient = await createClientRow({ consolidatedInvoicing: true });
    const newClient = await createClientRow({ consolidatedInvoicing: true });
    const order = await createOrder({ clientId: oldClient.id, status: "approved" });

    const res = await request(app)
      .post(`/orders/${order.id}/reassign-client`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ client_id: newClient.id });

    expect(res.status).toBe(200);
    expect(res.body.order.client_id).toBe(newClient.id);
    expect(res.body.invoice).toBeNull();
  });

  it("blocks reassigning an order already bundled into a consolidated invoice", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const other = await createClientRow();
    const order = await createOrder({
      clientId: client.id, status: "approved",
      items: [{ description: "X", qty: 1, unit_price: 10 }],
    });
    await request(app)
      .post(`/clients/${client.id}/consolidated-invoice`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ order_ids: [order.id], invoice_no: "SI-REV-001" });

    const res = await request(app)
      .post(`/orders/${order.id}/reassign-client`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ client_id: other.id });

    expect(res.status).toBe(409);
  });

  it("409s if the order isn't approved", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const other = await createClientRow();
    const order = await createOrder({ clientId: client.id, status: "pending" });

    const res = await request(app)
      .post(`/orders/${order.id}/reassign-client`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ client_id: other.id });

    expect(res.status).toBe(409);
  });

  it("404s for a nonexistent target client", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({ clientId: client.id, status: "approved" });

    const res = await request(app)
      .post(`/orders/${order.id}/reassign-client`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ client_id: "00000000-0000-0000-0000-000000000000" });

    expect(res.status).toBe(404);
  });
});

describe("PATCH /orders/:id", () => {
  it("lets the owning agent revise items and PO fields while pending", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow({ agentId: agent.id });
    const order = await createOrder({
      clientId: client.id, status: "pending",
      items: [{ description: "Old item", qty: 1, unit_price: 100 }],
    });

    const res = await request(app)
      .patch(`/orders/${order.id}`)
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .field("items", JSON.stringify([{ description: "New item", qty: 2, unit_price: 150 }]))
      .field("po_number", "PO-9001");

    expect(res.status).toBe(200);
    expect(res.body.po_number).toBe("PO-9001");

    const { rows } = await pool.query("SELECT description, qty, unit_price FROM order_items WHERE order_id = $1", [order.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe("New item");
    expect(Number(rows[0].qty)).toBe(2);
  });

  it("lets admin revise too", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({ clientId: client.id, status: "pending", items: [{ description: "A", qty: 1, unit_price: 10 }] });

    const res = await request(app)
      .patch(`/orders/${order.id}`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .field("items", JSON.stringify([{ description: "B", qty: 1, unit_price: 20 }]));

    expect(res.status).toBe(200);
  });

  it("404s for an agent who isn't assigned to the order's client", async () => {
    const owner = await createUser({ role: "agent" });
    const stranger = await createUser({ role: "agent" });
    const client = await createClientRow({ agentId: owner.id });
    const order = await createOrder({ clientId: client.id, status: "pending", items: [{ description: "A", qty: 1, unit_price: 10 }] });

    const res = await request(app)
      .patch(`/orders/${order.id}`)
      .set("Authorization", `Bearer ${tokenFor(stranger)}`)
      .field("items", JSON.stringify([{ description: "B", qty: 1, unit_price: 20 }]));

    expect(res.status).toBe(404);
  });

  it("409s once the order is no longer pending", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow({ agentId: agent.id });
    const order = await createOrder({ clientId: client.id, status: "approved", items: [{ description: "A", qty: 1, unit_price: 10 }] });

    const res = await request(app)
      .patch(`/orders/${order.id}`)
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .field("items", JSON.stringify([{ description: "B", qty: 1, unit_price: 20 }]));

    expect(res.status).toBe(409);
  });
});
