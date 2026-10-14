import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import { createClientRow, createInvoice, createOrder, createUser, tokenFor } from "../fixtures";

const asAdmin = async () => tokenFor(await createUser({ role: "admin" }));
const rename = (token: string, id: string, body: object) =>
  request(app).patch(`/invoices/${id}/invoice-no`).set("Authorization", `Bearer ${token}`).send(body);

describe("PATCH /invoices/:id/invoice-no", () => {
  it("renames the SI in place, keeping the order, amount, status and payments attached", async () => {
    const token = await asAdmin();
    const client = await createClientRow();
    const order = await createOrder({ clientId: client.id, status: "approved" });
    const invoice = await createInvoice({ clientId: client.id, amount: 1000, orderId: order.id, invoiceNo: "OLD-100" });
    await request(app).post(`/invoices/${invoice.id}/payments`).set("Authorization", `Bearer ${token}`).send({ amount_received: 400 });

    const res = await rename(token, invoice.id, { invoice_no: "  NEW-200 ", reason: "Reinvoiced under the new SI book" });

    expect(res.status).toBe(200);
    expect(res.body.invoice_no).toBe("NEW-200");
    expect(res.body.id).toBe(invoice.id);
    expect(res.body.order_id).toBe(order.id);
    expect(Number(res.body.amount)).toBe(1000);
    const pays = await pool.query("SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1", [invoice.id]);
    expect(pays.rows[0].n).toBe(1);

    const log = await pool.query("SELECT detail FROM audit_log WHERE action = 'invoice.number_changed' AND entity_id = $1", [invoice.id]);
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].detail).toMatchObject({ from: "OLD-100", to: "NEW-200", reason: "Reinvoiced under the new SI book" });
  });

  it("also works on a paid invoice, and on a change of letter case alone", async () => {
    const token = await asAdmin();
    const client = await createClientRow();
    const paid = await createInvoice({ clientId: client.id, amount: 500, status: "paid", invoiceNo: "si-9" });
    expect((await rename(token, paid.id, { invoice_no: "SI-9", reason: "Fix the case" })).status).toBe(200);
    expect((await rename(token, paid.id, { invoice_no: "SI-10", reason: "Reissued" })).body.status).toBe("paid");
  });

  it("refuses a number another live invoice already has, ignoring case, but allows a voided invoice's", async () => {
    const token = await asAdmin();
    const client = await createClientRow();
    const a = await createInvoice({ clientId: client.id, amount: 100, invoiceNo: "A-1" });
    await createInvoice({ clientId: client.id, amount: 100, invoiceNo: "TAKEN-1" });
    await createInvoice({ clientId: client.id, amount: 100, invoiceNo: "VOIDED-1", status: "void" });

    const clash = await rename(token, a.id, { invoice_no: "taken-1", reason: "should clash" });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toContain("already in use");
    expect((await rename(token, a.id, { invoice_no: "VOIDED-1", reason: "reuse a voided number" })).status).toBe(200);
  });

  it("needs a number and a reason, and refuses a no-op", async () => {
    const token = await asAdmin();
    const client = await createClientRow();
    const inv = await createInvoice({ clientId: client.id, amount: 100, invoiceNo: "SAME-1" });

    expect((await rename(token, inv.id, { invoice_no: "  ", reason: "blank number" })).status).toBe(400);
    expect((await rename(token, inv.id, { invoice_no: "NEW-1" })).status).toBe(400);
    expect((await rename(token, inv.id, { invoice_no: "NEW-1", reason: " " })).status).toBe(400);
    expect((await rename(token, inv.id, { invoice_no: "SAME-1", reason: "no change" })).status).toBe(409);
  });

  it("won't renumber a void invoice, and is admin-only", async () => {
    const token = await asAdmin();
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow();
    const voided = await createInvoice({ clientId: client.id, amount: 100, status: "void" });
    const live = await createInvoice({ clientId: client.id, amount: 100 });

    expect((await rename(token, voided.id, { invoice_no: "X-1", reason: "void one" })).status).toBe(409);
    expect((await rename(tokenFor(agent), live.id, { invoice_no: "X-2", reason: "agent attempt" })).status).toBe(403);
    expect((await rename(token, "00000000-0000-0000-0000-000000000000", { invoice_no: "X-3", reason: "missing" })).status).toBe(404);
  });
});
