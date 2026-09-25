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

  it("counts an invoice with EWT withheld but no 2307 on file as missing_2307_count", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    // Left short on purpose so the invoice stays open (status unpaid) and
    // in the dashboard's scope — a payment that fully settles the invoice
    // would flip it to 'paid' and drop it out of payments-due entirely.
    const invoice = await createInvoice({ clientId: client.id, amount: 1000, status: "unpaid" });
    await request(app)
      .post(`/invoices/${invoice.id}/payments`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ amount_received: 500, ewt_amount: 20 });

    const res = await request(app).get("/dashboard/payments-due").set("Authorization", `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.missing_2307_count).toBe(1);
    const row = res.body.invoices.find((i: any) => i.id === invoice.id);
    expect(Number(row.total_ewt)).toBe(20);
    expect(row.ewt_name).toBeNull();
  });

  it("does not count an invoice once its 2307 is on file", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000, status: "unpaid" });
    await request(app)
      .post(`/invoices/${invoice.id}/payments`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ amount_received: 500, ewt_amount: 20 });
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
});
