import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { createClientRow, createInvoice, createUser, tokenFor } from "../fixtures";
import { pool } from "../../src/db";
import { issueUploadToken } from "../../src/lib/tokens";

const asAdmin = async () => {
  const admin = await createUser({ role: "admin" });
  return { admin, token: tokenFor(admin) };
};

describe("POST /invoices/:id/payments", () => {
  it("closes the invoice out when the full amount is received", async () => {
    const { token } = await asAdmin();
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount_received: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.fully_paid).toBe(true);
    expect(Number(res.body.balance_due)).toBe(0);
    expect(res.body.invoice.status).toBe("paid");
  });

  it("leaves a balance and keeps the invoice open on a short payment", async () => {
    const { token } = await asAdmin();
    const client = await createClientRow();
    // Simulates a client paying net of EWT without submitting the 2307 yet.
    const invoice = await createInvoice({ clientId: client.id, amount: 1000, status: "receipt_uploaded" });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount_received: 980 });

    expect(res.status).toBe(200);
    expect(res.body.fully_paid).toBe(false);
    expect(Number(res.body.balance_due)).toBe(20);
    // A short payment re-enters the normal reminder cycle, not "receipt_uploaded".
    expect(res.body.invoice.status).toBe("unpaid");
  });

  it("closes the balance when cash plus EWT together cover the invoice", async () => {
    const { token } = await asAdmin();
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount_received: 980, ewt_amount: 20 });

    expect(res.status).toBe(200);
    expect(res.body.fully_paid).toBe(true);
    expect(res.body.invoice.status).toBe("paid");
  });

  it("accumulates multiple partial payments toward the same invoice", async () => {
    const { token } = await asAdmin();
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });

    const first = await request(app)
      .post(`/invoices/${invoice.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount_received: 400 });
    expect(first.body.fully_paid).toBe(false);
    expect(Number(first.body.balance_due)).toBe(600);

    const second = await request(app)
      .post(`/invoices/${invoice.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount_received: 600 });
    expect(second.body.fully_paid).toBe(true);
    expect(Number(second.body.balance_due)).toBe(0);
  });

  it("treats a sub-peso rounding remainder as fully settled", async () => {
    const { token } = await asAdmin();
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount_received: 999.5 }); // 50 centavos short, within the ₱1 tolerance

    expect(res.body.fully_paid).toBe(true);
    expect(res.body.invoice.status).toBe("paid");
  });

  it("refuses to record a payment against an already-paid invoice", async () => {
    const { token } = await asAdmin();
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000, status: "paid" });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount_received: 1000 });

    expect(res.status).toBe(409);
  });

  it("revokes outstanding receipt-purpose upload tokens once fully paid, but not ewt-purpose ones", async () => {
    const { token } = await asAdmin();
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });
    await issueUploadToken(invoice.id, undefined, "receipt");
    await issueUploadToken(invoice.id, undefined, "ewt");

    await request(app)
      .post(`/invoices/${invoice.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount_received: 1000 });

    const { rows } = await pool.query(
      "SELECT purpose, revoked_at FROM upload_tokens WHERE invoice_id = $1 ORDER BY purpose",
      [invoice.id]
    );
    const receiptToken = rows.find((r) => r.purpose === "receipt");
    const ewtToken = rows.find((r) => r.purpose === "ewt");
    expect(receiptToken.revoked_at).not.toBeNull();
    expect(ewtToken.revoked_at).toBeNull();
  });

  it("is admin-only — an agent gets 403", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/payments`)
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .send({ amount_received: 1000 });

    expect(res.status).toBe(403);
  });
});
