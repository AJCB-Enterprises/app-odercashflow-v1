import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import { createClientRow, createInvoice, createOrder, createUser, tokenFor } from "../fixtures";

describe("order approval for consolidated-invoicing clients", () => {
  it("marks the order delivered without creating an invoice, and records the DR number", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const order = await createOrder({ clientId: client.id, items: [{ description: "Widget", qty: 2, unit_price: 50 }] });

    const res = await request(app)
      .post(`/orders/${order.id}/approve`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ dr_no: "DR-2026-0001" });

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe("approved");
    expect(res.body.order.dr_no).toBe("DR-2026-0001");
    expect(res.body.invoice).toBeNull();

    const { rows } = await pool.query("SELECT * FROM invoices WHERE order_id = $1", [order.id]);
    expect(rows).toHaveLength(0);
  });

  it("still requires invoice_no for a non-consolidated client", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({ clientId: client.id });

    const res = await request(app)
      .post(`/orders/${order.id}/approve`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it("requires a DR number for a consolidated-invoicing client", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const order = await createOrder({ clientId: client.id, items: [{ description: "Widget", qty: 1, unit_price: 50 }] });

    const res = await request(app)
      .post(`/orders/${order.id}/approve`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it("rejects a duplicate DR number", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const orderA = await createOrder({ clientId: client.id, items: [{ description: "A", qty: 1, unit_price: 10 }] });
    const orderB = await createOrder({ clientId: client.id, items: [{ description: "B", qty: 1, unit_price: 10 }] });

    const first = await request(app)
      .post(`/orders/${orderA.id}/approve`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ dr_no: "DR-2026-0099" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/orders/${orderB.id}/approve`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ dr_no: "dr-2026-0099" }); // case-insensitive duplicate
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/DR number/i);
  });
});

describe("POST /clients/:id/consolidated-invoice", () => {
  it("bundles several approved orders into one invoice with the summed amount", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const orderA = await createOrder({
      clientId: client.id, status: "approved",
      items: [{ description: "Widget A", qty: 2, unit_price: 50 }],
    });
    const orderB = await createOrder({
      clientId: client.id, status: "approved",
      items: [{ description: "Widget B", qty: 1, unit_price: 250 }],
    });

    const res = await request(app)
      .post(`/clients/${client.id}/consolidated-invoice`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ order_ids: [orderA.id, orderB.id], invoice_no: "SI-2026-CONS-001" });

    expect(res.status).toBe(201);
    expect(Number(res.body.invoice.amount)).toBe(350);
    expect(res.body.invoice.order_id).toBeNull();
    expect(res.body.order_ids.sort()).toEqual([orderA.id, orderB.id].sort());

    const { rows: linkRows } = await pool.query("SELECT * FROM invoice_orders WHERE invoice_id = $1", [res.body.invoice.id]);
    expect(linkRows).toHaveLength(2);

    const detail = await request(app).get(`/clients/${client.id}`).set("Authorization", `Bearer ${tokenFor(admin)}`);
    const returnedOrders = detail.body.orders as any[];
    expect(returnedOrders.find((o) => o.id === orderA.id).is_invoiced).toBe(true);
    expect(returnedOrders.find((o) => o.id === orderB.id).is_invoiced).toBe(true);
  });

  it("rejects an order that belongs to a different client", async () => {
    const admin = await createUser({ role: "admin" });
    const clientA = await createClientRow({ consolidatedInvoicing: true });
    const clientB = await createClientRow({ consolidatedInvoicing: true });
    const orderFromA = await createOrder({ clientId: clientA.id, status: "approved", items: [{ description: "X", qty: 1, unit_price: 10 }] });

    const res = await request(app)
      .post(`/clients/${clientB.id}/consolidated-invoice`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ order_ids: [orderFromA.id], invoice_no: "SI-2026-CONS-002" });

    expect(res.status).toBe(409);
  });

  it("rejects an order that is not approved", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const pending = await createOrder({ clientId: client.id, status: "pending", items: [{ description: "X", qty: 1, unit_price: 10 }] });

    const res = await request(app)
      .post(`/clients/${client.id}/consolidated-invoice`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ order_ids: [pending.id], invoice_no: "SI-2026-CONS-003" });

    expect(res.status).toBe(409);
  });

  it("rejects an order that's already been consolidated into another invoice", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const order = await createOrder({ clientId: client.id, status: "approved", items: [{ description: "X", qty: 1, unit_price: 10 }] });

    const first = await request(app)
      .post(`/clients/${client.id}/consolidated-invoice`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ order_ids: [order.id], invoice_no: "SI-2026-CONS-004" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/clients/${client.id}/consolidated-invoice`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ order_ids: [order.id], invoice_no: "SI-2026-CONS-005" });
    expect(second.status).toBe(409);
  });

  it("rejects a duplicate invoice number", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    await createInvoice({ clientId: client.id, amount: 100, invoiceNo: "SI-2026-CONS-006" });
    const order = await createOrder({ clientId: client.id, status: "approved", items: [{ description: "X", qty: 1, unit_price: 10 }] });

    const res = await request(app)
      .post(`/clients/${client.id}/consolidated-invoice`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ order_ids: [order.id], invoice_no: "SI-2026-CONS-006" });

    expect(res.status).toBe(409);
  });

  it("rejects a client that isn't set up for consolidated invoicing", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({ clientId: client.id, status: "approved", items: [{ description: "X", qty: 1, unit_price: 10 }] });

    const res = await request(app)
      .post(`/clients/${client.id}/consolidated-invoice`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ order_ids: [order.id], invoice_no: "SI-2026-CONS-007" });

    expect(res.status).toBe(400);
  });
});

describe("PATCH /clients/:id — disabling consolidated_invoicing", () => {
  it("blocks turning it off while an approved order is still uninvoiced", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    await createOrder({ clientId: client.id, status: "approved", items: [{ description: "X", qty: 1, unit_price: 10 }] });

    const res = await request(app)
      .patch(`/clients/${client.id}`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ consolidated_invoicing: false });

    expect(res.status).toBe(409);
  });

  it("allows turning it off once everything is consolidated", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const order = await createOrder({ clientId: client.id, status: "approved", items: [{ description: "X", qty: 1, unit_price: 10 }] });
    await request(app)
      .post(`/clients/${client.id}/consolidated-invoice`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ order_ids: [order.id], invoice_no: "SI-2026-CONS-008" });

    const res = await request(app)
      .patch(`/clients/${client.id}`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ consolidated_invoicing: false });

    expect(res.status).toBe(200);
    expect(res.body.consolidated_invoicing).toBe(false);
  });
});
