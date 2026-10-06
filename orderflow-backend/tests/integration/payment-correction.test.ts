import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import { createClientRow, createInvoice, createUser, tokenFor } from "../fixtures";

const asAdmin = async () => tokenFor(await createUser({ role: "admin" }));

const record = (token: string, invoiceId: string, body: object) =>
  request(app).post(`/invoices/${invoiceId}/payments`).set("Authorization", `Bearer ${token}`).send(body);

const correct = (token: string, invoiceId: string, paymentId: string, body: object) =>
  request(app).patch(`/invoices/${invoiceId}/payments/${paymentId}`).set("Authorization", `Bearer ${token}`).send(body);

const paymentsOf = async (invoiceId: string) =>
  (await pool.query("SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY verified_at", [invoiceId])).rows;

describe("PATCH /invoices/:id/payments/:paymentId", () => {
  it("moves cash that was keyed into Discount over to Received, keeping the invoice paid", async () => {
    const token = await asAdmin();
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 5460 });
    const rec = await record(token, invoice.id, { amount_received: 0, ewt_amount: 48.75, discount_amount: 5411.25 });
    expect(rec.body.invoice.status).toBe("paid");
    const [payment] = await paymentsOf(invoice.id);

    const res = await correct(token, invoice.id, payment.id, {
      amount_received: 5411.25, discount_amount: 0, reason: "Cash was entered as a discount",
    });

    expect(res.status).toBe(200);
    expect(Number(res.body.payment.amount_received)).toBe(5411.25);
    expect(Number(res.body.payment.discount_amount)).toBe(0);
    expect(Number(res.body.payment.ewt_amount)).toBe(48.75);
    expect(res.body.invoice.status).toBe("paid");
    expect(res.body.status_change).toBeNull();
    expect(Number(res.body.balance_due)).toBe(0);

    const { rows } = await pool.query("SELECT detail FROM audit_log WHERE action = 'invoice.payment_corrected' AND entity_id = $1", [invoice.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].detail.reason).toBe("Cash was entered as a discount");
    expect(rows[0].detail.before.discount_amount).toBe(5411.25);
    expect(rows[0].detail.after.discount_amount).toBe(0);
  });

  it("reopens a paid invoice when the corrected amounts no longer cover it", async () => {
    const token = await asAdmin();
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });
    await record(token, invoice.id, { amount_received: 1000 });
    const [payment] = await paymentsOf(invoice.id);

    const res = await correct(token, invoice.id, payment.id, { amount_received: 400, reason: "Only part was received" });

    expect(res.status).toBe(200);
    expect(res.body.status_change).toBe("reopened");
    expect(res.body.invoice.status).toBe("unpaid");
    expect(res.body.invoice.paid_at).toBeNull();
    expect(Number(res.body.balance_due)).toBe(600);
  });

  it("closes an open invoice when the corrected amounts now cover it", async () => {
    const token = await asAdmin();
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });
    await record(token, invoice.id, { amount_received: 500 });
    const [payment] = await paymentsOf(invoice.id);

    const res = await correct(token, invoice.id, payment.id, { amount_received: 1000, reason: "Typo, full amount was paid" });

    expect(res.status).toBe(200);
    expect(res.body.status_change).toBe("paid");
    expect(res.body.invoice.status).toBe("paid");
  });

  it("requires a reason and an actual change", async () => {
    const token = await asAdmin();
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });
    await record(token, invoice.id, { amount_received: 1000 });
    const [payment] = await paymentsOf(invoice.id);

    expect((await correct(token, invoice.id, payment.id, { amount_received: 900 })).status).toBe(400);
    expect((await correct(token, invoice.id, payment.id, { amount_received: 900, reason: "  " })).status).toBe(400);
    expect((await correct(token, invoice.id, payment.id, { amount_received: 1000, reason: "no actual change" })).status).toBe(409);
  });

  it("is admin-only, and 404s for another invoice's payment", async () => {
    const token = await asAdmin();
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow();
    const a = await createInvoice({ clientId: client.id, amount: 1000 });
    const b = await createInvoice({ clientId: client.id, amount: 1000 });
    await record(token, a.id, { amount_received: 1000 });
    const [payment] = await paymentsOf(a.id);

    const denied = await correct(tokenFor(agent), a.id, payment.id, { amount_received: 900, reason: "agent attempt" });
    expect(denied.status).toBe(403);
    const wrongInvoice = await correct(token, b.id, payment.id, { amount_received: 900, reason: "wrong invoice" });
    expect(wrongInvoice.status).toBe(404);
  });

  it("won't correct a void invoice's payment", async () => {
    const token = await asAdmin();
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });
    await record(token, invoice.id, { amount_received: 500 });
    await pool.query("UPDATE invoices SET status = 'void' WHERE id = $1", [invoice.id]);
    const [payment] = await paymentsOf(invoice.id);

    const res = await correct(token, invoice.id, payment.id, { amount_received: 400, reason: "should be blocked" });
    expect(res.status).toBe(409);
  });
});

describe("Collection Receipt number handling", () => {
  it("strips a typed 'CR #' prefix when recording, so it can't hide a duplicate", async () => {
    const token = await asAdmin();
    const client = await createClientRow();
    const a = await createInvoice({ clientId: client.id, amount: 1000 });
    const b = await createInvoice({ clientId: client.id, amount: 1000 });

    await record(token, a.id, { amount_received: 1000, collection_receipt_no: "CR #20488" });
    expect((await paymentsOf(a.id))[0].collection_receipt_no).toBe("20488");

    const dup = await record(token, b.id, { amount_received: 1000, collection_receipt_no: "20488" });
    expect(dup.status).toBe(409);
  });

  it("leaves a number that legitimately starts with CR alone", async () => {
    const token = await asAdmin();
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });
    await record(token, invoice.id, { amount_received: 1000, collection_receipt_no: "CR-2026-0001" });
    expect((await paymentsOf(invoice.id))[0].collection_receipt_no).toBe("CR-2026-0001");
  });

  it("lets a correction fix or clear the CR number, and refuses one already in use", async () => {
    const token = await asAdmin();
    const client = await createClientRow();
    const a = await createInvoice({ clientId: client.id, amount: 1000 });
    const b = await createInvoice({ clientId: client.id, amount: 1000 });
    await pool.query("INSERT INTO invoice_payments (invoice_id, amount_received, verified_by, collection_receipt_no) SELECT $1, 1000, id, 'CR #20488' FROM users LIMIT 1", [a.id]);
    await record(token, b.id, { amount_received: 1000, collection_receipt_no: "555" });
    const [pa] = await paymentsOf(a.id);
    const [pb] = await paymentsOf(b.id);

    const fixed = await correct(token, a.id, pa.id, { collection_receipt_no: "CR #20488", reason: "tidy the number" });
    expect(fixed.status).toBe(200);
    expect(fixed.body.payment.collection_receipt_no).toBe("20488");

    const clash = await correct(token, b.id, pb.id, { collection_receipt_no: "20488", reason: "clash" });
    expect(clash.status).toBe(409);

    const cleared = await correct(token, b.id, pb.id, { collection_receipt_no: null, reason: "no CR was issued" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.payment.collection_receipt_no).toBeNull();
  });
});

describe("GET /invoices/:id/payments", () => {
  it("lists an invoice's payment entries for admin", async () => {
    const token = await asAdmin();
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });
    await record(token, invoice.id, { amount_received: 400 });
    await record(token, invoice.id, { amount_received: 600 });

    const res = await request(app).get(`/invoices/${invoice.id}/payments`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(2);
    expect(res.body.invoice.invoice_no).toBe(invoice.invoice_no);
  });
});
