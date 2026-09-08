import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import { resendReminderForInvoice } from "../../src/worker/reminders";
import { createClientRow, createInvoice, createUser, tokenFor } from "../fixtures";

describe("clients flagged collects_in_person", () => {
  it("persists and round-trips through the client API", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({
        company_name: "Check Co", contact_name: "Jam", email: "jam@check.test",
        phone: "0917 000 0000", address: "Davao City", tin: "111-111-111-000",
        collects_in_person: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.collects_in_person).toBe(true);

    const detail = await request(app).get(`/clients/${res.body.id}`).set("Authorization", `Bearer ${tokenFor(admin)}`);
    expect(detail.body.client.collects_in_person).toBe(true);
  });

  it("still completes the reminder send (no email link swapped in) without erroring", async () => {
    const client = await createClientRow({ collectsInPerson: true });
    const invoice = await createInvoice({ clientId: client.id, amount: 500 });

    const result = await resendReminderForInvoice(invoice.id);
    expect(result.manual).toBe(false);

    const { rows } = await pool.query("SELECT * FROM reminder_logs WHERE invoice_id = $1", [invoice.id]);
    expect(rows).toHaveLength(1);
  });

  it("shows up in the dashboard's manual_collection_count and per-row flag", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow({ collectsInPerson: true });
    await createInvoice({ clientId: client.id, amount: 750 });

    const res = await request(app).get("/dashboard/payments-due").set("Authorization", `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.manual_collection_count).toBeGreaterThanOrEqual(1);
    const row = res.body.invoices.find((i: any) => i.client_id === client.id);
    expect(row.collects_in_person).toBe(true);
  });
});
