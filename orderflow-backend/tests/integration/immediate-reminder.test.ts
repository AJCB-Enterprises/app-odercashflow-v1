import { describe, expect, it, vi } from "vitest";
import { pool } from "../../src/db";
import * as emailLib from "../../src/lib/email";
import { sendImmediateReminderForClient } from "../../src/worker/reminders";
import { createClientRow, createInvoice, createOrder } from "../fixtures";

describe("sendImmediateReminderForClient", () => {
  it("sends and logs a reminder for a client's one due unpaid invoice", async () => {
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 500 });

    const sent = await sendImmediateReminderForClient(client.id);

    expect(sent).toBe(1);
    const { rows } = await pool.query("SELECT * FROM reminder_logs WHERE invoice_id = $1", [invoice.id]);
    expect(rows).toHaveLength(1);
  });

  it("bypasses the frequency-days cooldown that would block a normal scheduled send", async () => {
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 500 });
    // Simulate a reminder that was "sent" moments ago -- to the bad address,
    // presumably, since that's exactly why the admin is fixing the email.
    await pool.query(
      "INSERT INTO reminder_logs (type, invoice_id, client_id, sent_to, subject, sent_at) VALUES ('payment', $1, $2, 'old@bad.test', 'x', now())",
      [invoice.id, client.id]
    );

    const sent = await sendImmediateReminderForClient(client.id);

    expect(sent).toBe(1);
    const { rows } = await pool.query("SELECT * FROM reminder_logs WHERE invoice_id = $1 ORDER BY sent_at", [
      invoice.id,
    ]);
    expect(rows).toHaveLength(2);
  });

  it("does nothing when the client has no unpaid invoices", async () => {
    const client = await createClientRow();
    await createInvoice({ clientId: client.id, amount: 500, status: "paid" });

    const sent = await sendImmediateReminderForClient(client.id);
    expect(sent).toBe(0);
  });

  it("does nothing when payment reminders are globally disabled", async () => {
    await pool.query("UPDATE reminder_settings SET is_enabled = false WHERE type = 'payment'");
    const client = await createClientRow();
    await createInvoice({ clientId: client.id, amount: 500 });

    const sent = await sendImmediateReminderForClient(client.id);
    expect(sent).toBe(0);
  });

  it("consolidates 2+ due invoices into a single Statement of Account send", async () => {
    const client = await createClientRow();
    const invA = await createInvoice({ clientId: client.id, amount: 300 });
    const invB = await createInvoice({ clientId: client.id, amount: 700 });

    const sent = await sendImmediateReminderForClient(client.id);

    expect(sent).toBe(2);
    const { rows } = await pool.query("SELECT invoice_id, provider_id FROM reminder_logs WHERE invoice_id = ANY($1)", [
      [invA.id, invB.id],
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].provider_id).toBe(rows[1].provider_id); // one email covering both
  });

  it("re-sends the order-approved notice for an order behind a due invoice", async () => {
    const spy = vi.spyOn(emailLib, "sendMail");
    const client = await createClientRow();
    const order = await createOrder({ clientId: client.id, status: "approved" });
    await createInvoice({ clientId: client.id, amount: 500, orderId: order.id });

    await sendImmediateReminderForClient(client.id);

    const approvalCall = spy.mock.calls.find(([, subject]) => String(subject).includes(order.order_no));
    expect(approvalCall).toBeDefined();
    spy.mockRestore();
  });

  it("skips the order-approved resend when the invoice has no linked order", async () => {
    const spy = vi.spyOn(emailLib, "sendMail");
    const client = await createClientRow();
    await createInvoice({ clientId: client.id, amount: 500 }); // no orderId

    await sendImmediateReminderForClient(client.id);

    const approvalCall = spy.mock.calls.find(([, subject]) => String(subject).includes("approved"));
    expect(approvalCall).toBeUndefined();
    spy.mockRestore();
  });
});
