import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import { createClientRow, createInvoice, createOrder, createUser, tokenFor } from "../fixtures";

const itemIds = async (orderId: string) => {
  const { rows } = await pool.query("SELECT id, description FROM order_items WHERE order_id = $1", [orderId]);
  return rows as { id: string; description: string }[];
};

describe("POST /orders/:id/cancel-item", () => {
  it("removes one item from an approved order and shrinks its invoice amount", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({
      clientId: client.id, status: "approved",
      items: [
        { description: "Widget", qty: 10, unit_price: 100 },
        { description: "Gadget", qty: 1, unit_price: 200 },
      ],
    });
    await createInvoice({ clientId: client.id, amount: 1200, orderId: order.id, status: "unpaid" });
    const [widget] = (await itemIds(order.id)).filter((it) => it.description === "Widget");

    const res = await request(app)
      .post(`/orders/${order.id}/cancel-item`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ item_id: widget.id });

    expect(res.status).toBe(200);
    expect(Number(res.body.invoice.amount)).toBe(200);

    const remaining = await itemIds(order.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].description).toBe("Gadget");
  });

  it("nets the order's own discount off the shrunk invoice amount", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({
      clientId: client.id, status: "approved",
      items: [
        { description: "Widget", qty: 10, unit_price: 100 },
        { description: "Gadget", qty: 1, unit_price: 200 },
      ],
      discountAmount: 50,
    });
    await createInvoice({ clientId: client.id, amount: 1150, orderId: order.id, status: "unpaid" });
    const [widget] = (await itemIds(order.id)).filter((it) => it.description === "Widget");

    const res = await request(app)
      .post(`/orders/${order.id}/cancel-item`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ item_id: widget.id });

    expect(res.status).toBe(200);
    expect(Number(res.body.invoice.amount)).toBe(150); // 200 - 50 discount
  });

  it("blocks when the remaining subtotal would be smaller than the order's own discount", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({
      clientId: client.id, status: "approved",
      items: [
        { description: "Widget", qty: 1, unit_price: 100 },
        { description: "Gadget", qty: 1, unit_price: 10 },
      ],
      discountAmount: 50,
    });
    await createInvoice({ clientId: client.id, amount: 60, orderId: order.id, status: "unpaid" });
    const [widget] = (await itemIds(order.id)).filter((it) => it.description === "Widget");

    const res = await request(app)
      .post(`/orders/${order.id}/cancel-item`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ item_id: widget.id });

    expect(res.status).toBe(409);
    const remaining = await itemIds(order.id);
    expect(remaining).toHaveLength(2); // nothing was removed
  });

  it("removes an item from an approved consolidated-invoicing order with no invoice yet", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const order = await createOrder({
      clientId: client.id, status: "approved",
      items: [
        { description: "Widget", qty: 1, unit_price: 100 },
        { description: "Gadget", qty: 1, unit_price: 200 },
      ],
    });
    const [widget] = (await itemIds(order.id)).filter((it) => it.description === "Widget");

    const res = await request(app)
      .post(`/orders/${order.id}/cancel-item`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ item_id: widget.id });

    expect(res.status).toBe(200);
    expect(res.body.invoice).toBeNull();
    const remaining = await itemIds(order.id);
    expect(remaining).toHaveLength(1);
  });

  it("blocks cancelling the last remaining item", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({
      clientId: client.id, status: "approved",
      items: [{ description: "Widget", qty: 1, unit_price: 100 }],
    });
    await createInvoice({ clientId: client.id, amount: 100, orderId: order.id, status: "unpaid" });
    const [widget] = await itemIds(order.id);

    const res = await request(app)
      .post(`/orders/${order.id}/cancel-item`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ item_id: widget.id });

    expect(res.status).toBe(409);
  });

  it("404s for an item id that doesn't belong to the order", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({
      clientId: client.id, status: "approved",
      items: [{ description: "Widget", qty: 1, unit_price: 100 }],
    });

    const res = await request(app)
      .post(`/orders/${order.id}/cancel-item`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ item_id: "00000000-0000-0000-0000-000000000000" });

    expect(res.status).toBe(404);
  });

  it("blocks when the invoice already has payment activity", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({
      clientId: client.id, status: "approved",
      items: [
        { description: "Widget", qty: 1, unit_price: 100 },
        { description: "Gadget", qty: 1, unit_price: 200 },
      ],
    });
    const invoice = await createInvoice({ clientId: client.id, amount: 300, orderId: order.id, status: "unpaid" });
    await request(app)
      .post(`/invoices/${invoice.id}/payments`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ amount_received: 100 });
    const [widget] = (await itemIds(order.id)).filter((it) => it.description === "Widget");

    const res = await request(app)
      .post(`/orders/${order.id}/cancel-item`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ item_id: widget.id });

    expect(res.status).toBe(409);
  });

  it("blocks when the invoice is already paid", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({
      clientId: client.id, status: "approved",
      items: [
        { description: "Widget", qty: 1, unit_price: 100 },
        { description: "Gadget", qty: 1, unit_price: 200 },
      ],
    });
    await createInvoice({ clientId: client.id, amount: 300, orderId: order.id, status: "paid" });
    const [widget] = (await itemIds(order.id)).filter((it) => it.description === "Widget");

    const res = await request(app)
      .post(`/orders/${order.id}/cancel-item`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ item_id: widget.id });

    expect(res.status).toBe(409);
  });

  it("cancels an item from an order bundled into a consolidated invoice, recomputing across every bundled order", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const orderA = await createOrder({
      clientId: client.id, status: "approved",
      items: [
        { description: "Widget", qty: 1, unit_price: 100 },
        { description: "Gadget", qty: 1, unit_price: 200 },
      ],
    });
    const orderB = await createOrder({
      clientId: client.id, status: "approved",
      items: [{ description: "Sprocket", qty: 1, unit_price: 50 }],
    });
    const consolidateRes = await request(app)
      .post(`/clients/${client.id}/consolidated-invoice`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ order_ids: [orderA.id, orderB.id], invoice_no: "SI-CANCEL-ITEM-001" });
    expect(Number(consolidateRes.body.invoice.amount)).toBe(350); // 100 + 200 + 50
    const [widget] = (await itemIds(orderA.id)).filter((it) => it.description === "Widget");

    const res = await request(app)
      .post(`/orders/${orderA.id}/cancel-item`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ item_id: widget.id });

    expect(res.status).toBe(200);
    expect(res.body.consolidated).toBe(true);
    expect(Number(res.body.invoice.amount)).toBe(250); // 350 - 100, Gadget + Sprocket remain

    const { rows } = await pool.query("SELECT amount FROM invoices WHERE invoice_no = 'SI-CANCEL-ITEM-001'");
    expect(Number(rows[0].amount)).toBe(250);
  });

  it("nets each bundled order's own discount when recomputing the consolidated invoice", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const orderA = await createOrder({
      clientId: client.id, status: "approved",
      items: [
        { description: "Widget", qty: 1, unit_price: 100 },
        { description: "Gadget", qty: 1, unit_price: 200 },
      ],
      discountAmount: 20,
    });
    await request(app)
      .post(`/clients/${client.id}/consolidated-invoice`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ order_ids: [orderA.id], invoice_no: "SI-CANCEL-ITEM-002" });
    const [widget] = (await itemIds(orderA.id)).filter((it) => it.description === "Widget");

    const res = await request(app)
      .post(`/orders/${orderA.id}/cancel-item`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ item_id: widget.id });

    expect(res.status).toBe(200);
    expect(Number(res.body.invoice.amount)).toBe(180); // 200 - 20 discount
  });

  it("blocks when the consolidated invoice already has payment activity", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const order = await createOrder({
      clientId: client.id, status: "approved",
      items: [
        { description: "Widget", qty: 1, unit_price: 100 },
        { description: "Gadget", qty: 1, unit_price: 200 },
      ],
    });
    const consolidateRes = await request(app)
      .post(`/clients/${client.id}/consolidated-invoice`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ order_ids: [order.id], invoice_no: "SI-CANCEL-ITEM-003" });
    await request(app)
      .post(`/invoices/${consolidateRes.body.invoice.id}/payments`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ amount_received: 100 });
    const [widget] = (await itemIds(order.id)).filter((it) => it.description === "Widget");

    const res = await request(app)
      .post(`/orders/${order.id}/cancel-item`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ item_id: widget.id });

    expect(res.status).toBe(409);
  });

  it("still blocks cancelling the last item of an order bundled into a consolidated invoice", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const order = await createOrder({
      clientId: client.id, status: "approved",
      items: [{ description: "Widget", qty: 1, unit_price: 100 }],
    });
    await request(app)
      .post(`/clients/${client.id}/consolidated-invoice`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ order_ids: [order.id], invoice_no: "SI-CANCEL-ITEM-004" });
    const [widget] = await itemIds(order.id);

    const res = await request(app)
      .post(`/orders/${order.id}/cancel-item`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ item_id: widget.id });

    expect(res.status).toBe(409);
  });

  it("409s if the order isn't approved", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({
      clientId: client.id, status: "pending",
      items: [
        { description: "Widget", qty: 1, unit_price: 100 },
        { description: "Gadget", qty: 1, unit_price: 200 },
      ],
    });
    const [widget] = (await itemIds(order.id)).filter((it) => it.description === "Widget");

    const res = await request(app)
      .post(`/orders/${order.id}/cancel-item`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ item_id: widget.id });

    expect(res.status).toBe(409);
  });

  it("is admin-only — an agent gets 403", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow();
    const order = await createOrder({
      clientId: client.id, status: "approved",
      items: [
        { description: "Widget", qty: 1, unit_price: 100 },
        { description: "Gadget", qty: 1, unit_price: 200 },
      ],
    });
    const [widget] = (await itemIds(order.id)).filter((it) => it.description === "Widget");

    const res = await request(app)
      .post(`/orders/${order.id}/cancel-item`)
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .send({ item_id: widget.id });

    expect(res.status).toBe(403);
  });
});
