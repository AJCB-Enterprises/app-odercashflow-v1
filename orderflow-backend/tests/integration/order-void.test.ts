import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import { createClientRow, createInvoice, createOrder, createUser, tokenFor } from "../fixtures";

describe("GET /orders — invoice # column", () => {
  it("includes the invoice number for an order with a direct invoice", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({ clientId: client.id, status: "approved" });
    await createInvoice({ clientId: client.id, amount: 100, invoiceNo: "SI-LIST-001", orderId: order.id });

    const res = await request(app).get("/orders").set("Authorization", `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    const row = res.body.find((o: any) => o.id === order.id);
    expect(row.invoice_no).toBe("SI-LIST-001");
  });

  it("is null for an order with no invoice yet", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({ clientId: client.id, status: "pending" });

    const res = await request(app).get("/orders").set("Authorization", `Bearer ${tokenFor(admin)}`);

    const row = res.body.find((o: any) => o.id === order.id);
    expect(row.invoice_no).toBeNull();
  });
});

describe("POST /orders/:id/void", () => {
  it("marks the order cancelled and its unpaid invoice void", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({ clientId: client.id, status: "approved" });
    const invoice = await createInvoice({ clientId: client.id, amount: 500, orderId: order.id, status: "unpaid" });

    const res = await request(app)
      .post(`/orders/${order.id}/void`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ reason: "Client cancelled" });

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe("cancelled");
    expect(res.body.invoice.status).toBe("void");

    const { rows } = await pool.query("SELECT status FROM invoices WHERE id = $1", [invoice.id]);
    expect(rows[0].status).toBe("void");
  });

  it("voids an approved order with no invoice at all (consolidated-invoicing, not yet consolidated)", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const order = await createOrder({ clientId: client.id, status: "approved" });

    const res = await request(app)
      .post(`/orders/${order.id}/void`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe("cancelled");
    expect(res.body.invoice).toBeNull();
  });

  it("blocks voiding when the invoice is already paid", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({ clientId: client.id, status: "approved" });
    await createInvoice({ clientId: client.id, amount: 500, orderId: order.id, status: "paid" });

    const res = await request(app)
      .post(`/orders/${order.id}/void`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({});

    expect(res.status).toBe(409);
  });

  it("blocks voiding when a payment has been recorded even if the invoice is still 'unpaid' (a short payment)", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({ clientId: client.id, status: "approved" });
    const invoice = await createInvoice({ clientId: client.id, amount: 500, orderId: order.id, status: "unpaid" });

    const payRes = await request(app)
      .post(`/invoices/${invoice.id}/payments`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ amount_received: 200 });
    expect(payRes.body.fully_paid).toBe(false);

    const res = await request(app)
      .post(`/orders/${order.id}/void`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({});

    expect(res.status).toBe(409);
  });

  it("blocks voiding an order already bundled into a consolidated invoice", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ consolidatedInvoicing: true });
    const order = await createOrder({
      clientId: client.id, status: "approved",
      items: [{ description: "X", qty: 1, unit_price: 10 }],
    });
    await request(app)
      .post(`/clients/${client.id}/consolidated-invoice`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ order_ids: [order.id], invoice_no: "SI-VOID-CONS-001" });

    const res = await request(app)
      .post(`/orders/${order.id}/void`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({});

    expect(res.status).toBe(409);
  });

  it("409s if the order isn't approved", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({ clientId: client.id, status: "pending" });

    const res = await request(app)
      .post(`/orders/${order.id}/void`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({});

    expect(res.status).toBe(409);
  });
});
