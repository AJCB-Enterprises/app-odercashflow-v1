import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import { runReminders } from "../../src/worker/reminders";
import { createClientRow, createInvoice, createUser, tokenFor } from "../fixtures";

describe("clients without an email", () => {
  it("can be created with no email field at all", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ company_name: "No Email Co", contact_name: "Jam", phone: "0917 000 0000", address: "Davao City", tin: "111-111-111-000" });

    expect(res.status).toBe(201);
    expect(res.body.email).toBeNull();

    const { rows } = await pool.query("SELECT email FROM clients WHERE id = $1", [res.body.id]);
    expect(rows[0].email).toBeNull();
  });

  it("normalizes an empty-string email to null", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ company_name: "No Email Co", contact_name: "Jam", email: "", phone: "0917 000 0000", address: "Davao City", tin: "111-111-111-000" });

    expect(res.status).toBe(201);
    expect(res.body.email).toBeNull();
  });

  it("scheduler skips a no-email client's due invoice and logs nothing", async () => {
    const client = await createClientRow({ email: null });
    const invoice = await createInvoice({ clientId: client.id, amount: 500, dueDate: new Date().toISOString().slice(0, 10) });

    const result = await runReminders("payment", { force: true });
    expect(result.sent).toBe(0);

    const { rows } = await pool.query("SELECT * FROM reminder_logs WHERE invoice_id = $1", [invoice.id]);
    expect(rows).toHaveLength(0);
  });

  it("resend-reminder returns a manual link instead of emailing", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ email: null });
    const invoice = await createInvoice({ clientId: client.id, amount: 500 });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/resend-reminder`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.manual).toBe(true);
    expect(res.body.url).toMatch(/\/u\//);

    const { rows } = await pool.query("SELECT * FROM reminder_logs WHERE invoice_id = $1", [invoice.id]);
    expect(rows).toHaveLength(0);
  });

  it("ewt-link returns a manual link instead of emailing", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ email: null });
    const invoice = await createInvoice({ clientId: client.id, amount: 500 });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/ewt-link`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.manual).toBe(true);
    expect(res.body.url).toMatch(/\/e\//);
  });
});
