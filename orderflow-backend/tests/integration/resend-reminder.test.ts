import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import { resendReminderForInvoice } from "../../src/worker/reminders";
import { createClientRow, createInvoice, createUser, tokenFor } from "../fixtures";

describe("resendReminderForInvoice", () => {
  it("sends even when the invoice isn't within the days-before window yet", async () => {
    const client = await createClientRow();
    const farOut = new Date();
    farOut.setDate(farOut.getDate() + 60); // well outside the default 3-day window
    const invoice = await createInvoice({ clientId: client.id, amount: 500, dueDate: farOut.toISOString().slice(0, 10) });

    await resendReminderForInvoice(invoice.id);

    const { rows } = await pool.query("SELECT * FROM reminder_logs WHERE invoice_id = $1", [invoice.id]);
    expect(rows).toHaveLength(1);
  });

  it("bypasses the frequency-days cooldown", async () => {
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 500 });
    await pool.query(
      "INSERT INTO reminder_logs (type, invoice_id, client_id, sent_to, subject, sent_at) VALUES ('payment', $1, $2, 'x@x.test', 'x', now())",
      [invoice.id, client.id]
    );

    await resendReminderForInvoice(invoice.id);

    const { rows } = await pool.query("SELECT * FROM reminder_logs WHERE invoice_id = $1", [invoice.id]);
    expect(rows).toHaveLength(2);
  });

  it("rejects an already-paid invoice", async () => {
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 500, status: "paid" });
    await expect(resendReminderForInvoice(invoice.id)).rejects.toThrow(/not found|settled/i);
  });

  it("rejects an unknown invoice id", async () => {
    await expect(resendReminderForInvoice("00000000-0000-0000-0000-000000000000")).rejects.toThrow();
  });
});

describe("POST /invoices/:id/resend-reminder", () => {
  it("is admin-only", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 500 });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/resend-reminder`)
      .set("Authorization", `Bearer ${tokenFor(agent)}`);
    expect(res.status).toBe(403);
  });

  it("resends and returns ok for an admin", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 500 });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/resend-reminder`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const { rows } = await pool.query("SELECT * FROM reminder_logs WHERE invoice_id = $1", [invoice.id]);
    expect(rows).toHaveLength(1);
  });

  it("returns 409 for an already-paid invoice", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 500, status: "paid" });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/resend-reminder`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(409);
  });
});
