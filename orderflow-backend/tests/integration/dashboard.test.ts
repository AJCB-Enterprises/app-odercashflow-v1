import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import { createClientRow, createInvoice, createUser, tokenFor } from "../fixtures";

describe("GET /dashboard/payments-due", () => {
  it("admin sees invoices across every client", async () => {
    const admin = await createUser({ role: "admin" });
    const clientA = await createClientRow();
    const clientB = await createClientRow();
    await createInvoice({ clientId: clientA.id, amount: 100 });
    await createInvoice({ clientId: clientB.id, amount: 200 });

    const res = await request(app).get("/dashboard/payments-due").set("Authorization", `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    const clientIds = res.body.invoices.map((i: any) => i.client_id);
    expect(clientIds).toContain(clientA.id);
    expect(clientIds).toContain(clientB.id);
  });

  it("an agent only sees invoices for their own assigned clients", async () => {
    const agent = await createUser({ role: "agent" });
    const other = await createUser({ role: "agent" });
    const own = await createClientRow({ agentId: agent.id });
    const notOwn = await createClientRow({ agentId: other.id });
    await createInvoice({ clientId: own.id, amount: 300 });
    await createInvoice({ clientId: notOwn.id, amount: 400 });

    const res = await request(app).get("/dashboard/payments-due").set("Authorization", `Bearer ${tokenFor(agent)}`);

    expect(res.status).toBe(200);
    const clientIds = res.body.invoices.map((i: any) => i.client_id);
    expect(clientIds).toContain(own.id);
    expect(clientIds).not.toContain(notOwn.id);
  });

  it("counts an invoice lacking its 2307 only once it is paid in full, not while it is still open", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000, status: "unpaid" });
    const pay = (body: object) =>
      request(app).post(`/invoices/${invoice.id}/payments`).set("Authorization", `Bearer ${tokenFor(admin)}`).send(body);
    const dashboard = () => request(app).get("/dashboard/payments-due").set("Authorization", `Bearer ${tokenFor(admin)}`);

    // Short on purpose: tax was withheld, but the invoice stays open and is still being chased for payment.
    await pay({ amount_received: 500, ewt_amount: 20 });
    const open = await dashboard();
    expect(open.status).toBe(200);
    expect(open.body.summary.missing_2307_count).toBe(0);
    expect(open.body.invoices.map((i: any) => i.id)).toContain(invoice.id);

    // The rest arrives: now the invoice is closed and the 2307 is the only thing outstanding.
    await pay({ amount_received: 480 });
    const paid = await dashboard();
    expect(paid.body.summary.missing_2307_count).toBe(1);
    expect(paid.body.invoices.map((i: any) => i.id)).not.toContain(invoice.id);
    expect(paid.body.paid_missing_2307[0]).toMatchObject({ id: invoice.id, ewt_name: null });
    expect(Number(paid.body.paid_missing_2307[0].total_ewt)).toBe(20);
  });

  it("does not count a paid invoice once its 2307 is on file", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000, status: "unpaid" });
    await request(app)
      .post(`/invoices/${invoice.id}/payments`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ amount_received: 980, ewt_amount: 20 });
    await pool.query("UPDATE invoices SET ewt_name = 'form-2307.pdf' WHERE id = $1", [invoice.id]);

    const res = await request(app).get("/dashboard/payments-due").set("Authorization", `Bearer ${tokenFor(admin)}`);

    expect(res.body.summary.missing_2307_count).toBe(0);
  });

  it("does not count an invoice with no EWT at all", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    await createInvoice({ clientId: client.id, amount: 1000, status: "unpaid" });

    const res = await request(app).get("/dashboard/payments-due").set("Authorization", `Bearer ${tokenFor(admin)}`);

    expect(res.body.summary.missing_2307_count).toBe(0);
  });

  describe("the paid-invoice list behind the Lacking 2307 tile", () => {
    const paidWithEwt = async (clientId: string, opts: { status?: "paid" | "void"; ewt?: number } = {}) => {
      const admin = await createUser({ role: "admin" });
      const invoice = await createInvoice({ clientId, amount: 1000, status: opts.status ?? "paid" });
      await pool.query(
        "INSERT INTO invoice_payments (invoice_id, amount_received, ewt_amount, verified_by) VALUES ($1, $2, $3, $4)",
        [invoice.id, 1000 - (opts.ewt ?? 20), opts.ewt ?? 20, admin.id]
      );
      return invoice;
    };
    const get = async (user: { id: string; role: string }) =>
      (await request(app).get("/dashboard/payments-due").set("Authorization", `Bearer ${tokenFor(user)}`)).body;

    it("is returned separately, without touching the open-invoice figures", async () => {
      const admin = await createUser({ role: "admin" });
      const client = await createClientRow();
      const paid = await paidWithEwt(client.id);
      await createInvoice({ clientId: client.id, amount: 500, status: "unpaid" });

      const body = await get(admin);

      expect(body.summary.missing_2307_count).toBe(1);
      expect(body.paid_missing_2307.map((i: any) => i.id)).toEqual([paid.id]);
      expect(body.paid_missing_2307[0]).toMatchObject({ status: "paid", has_email: true });
      expect(Number(body.paid_missing_2307[0].total_ewt)).toBe(20);
      // The paid invoice is not an open invoice: it stays out of the list and the outstanding total.
      expect(body.invoices).toHaveLength(1);
      expect(body.summary.outstanding_total).toBe(500);
    });

    it("drop out once the 2307 is filed, and void or no-EWT invoices never count", async () => {
      const admin = await createUser({ role: "admin" });
      const client = await createClientRow();
      const filed = await paidWithEwt(client.id);
      await pool.query("UPDATE invoices SET ewt_name = '2307.pdf' WHERE id = $1", [filed.id]);
      await paidWithEwt(client.id, { status: "void" });
      await paidWithEwt(client.id, { ewt: 0 });

      const body = await get(admin);
      expect(body.summary.missing_2307_count).toBe(0);
      expect(body.paid_missing_2307).toEqual([]);
    });

    it("an agent only sees the ones for their own clients", async () => {
      const agent = await createUser({ role: "agent" });
      const other = await createUser({ role: "agent" });
      const own = await createClientRow({ agentId: agent.id });
      const notOwn = await createClientRow({ agentId: other.id });
      const mine = await paidWithEwt(own.id);
      await paidWithEwt(notOwn.id);

      const body = await get(agent);
      expect(body.summary.missing_2307_count).toBe(1);
      expect(body.paid_missing_2307.map((i: any) => i.id)).toEqual([mine.id]);
    });
  });
});
