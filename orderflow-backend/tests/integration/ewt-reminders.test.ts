import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import * as emailLib from "../../src/lib/email";
import { runReminders } from "../../src/worker/reminders";
import { createClientRow, createInvoice, createUser, tokenFor } from "../fixtures";

afterEach(() => vi.restoreAllMocks());

const enable = (opts: { days_before?: number; frequency_days?: number; max_reminders?: number } = {}) =>
  pool.query(
    `UPDATE reminder_settings SET is_enabled = true,
            days_before = COALESCE($1, days_before), frequency_days = COALESCE($2, frequency_days),
            max_reminders = COALESCE($3, max_reminders)
      WHERE type = 'ewt'`,
    [opts.days_before ?? null, opts.frequency_days ?? null, opts.max_reminders ?? null]
  );

/** An invoice with tax withheld on a payment recorded `daysAgo` days ago. */
const invoiceWithEwt = async (
  clientId: string,
  opts: { daysAgo?: number; ewt?: number; status?: "unpaid" | "paid" | "void"; invoiceNo?: string } = {}
) => {
  const admin = await createUser({ role: "admin" });
  const invoice = await createInvoice({ clientId, amount: 1000, status: opts.status ?? "paid", invoiceNo: opts.invoiceNo });
  await pool.query(
    `INSERT INTO invoice_payments (invoice_id, amount_received, ewt_amount, verified_by, verified_at)
     VALUES ($1, $2, $3, $4, now() - make_interval(days => $5))`,
    [invoice.id, 1000 - (opts.ewt ?? 20), opts.ewt ?? 20, admin.id, opts.daysAgo ?? 10]
  );
  return invoice;
};

const sentTo = async (type = "ewt") =>
  (await pool.query("SELECT * FROM reminder_logs WHERE type = $1::reminder_type ORDER BY sent_at", [type])).rows;

describe("BIR 2307 reminders", () => {
  it("are off until an admin turns them on", async () => {
    const client = await createClientRow();
    await invoiceWithEwt(client.id);
    const res = await runReminders("ewt", { force: true });
    expect(res).toMatchObject({ sent: 0, skipped_reason: "disabled" });
  });

  it("email the client a secure 2307 link, naming the invoice and the tax withheld", async () => {
    await enable();
    const client = await createClientRow({ contactName: "Maria" });
    await invoiceWithEwt(client.id, { invoiceNo: "SI-500", ewt: 48.75 });
    const spy = vi.spyOn(emailLib, "sendMail");

    const res = await runReminders("ewt", { force: true });

    expect(res.sent).toBe(1);
    const [, subject, body] = spy.mock.calls[0] as [any, string, string];
    expect(subject).toBe("Please submit your BIR Form 2307 for SI-500");
    expect(body).toContain("Maria");
    expect(body).toContain("SI-500");
    expect(body).toContain("48.75");
    expect(body).toMatch(/\/e\/[A-Za-z0-9_-]+/);
    expect(await sentTo()).toHaveLength(1);
    const tokens = await pool.query("SELECT purpose FROM upload_tokens");
    expect(tokens.rows.map((t) => t.purpose)).toEqual(["ewt"]);
  });

  it("cover paid invoices only, skipping ones still being paid, void ones, ones with a 2307 on file, and ones with no tax withheld", async () => {
    await enable();
    const client = await createClientRow();
    await invoiceWithEwt(client.id, { status: "paid", invoiceNo: "PAID-1" });
    await invoiceWithEwt(client.id, { status: "unpaid", invoiceNo: "OPEN-1" });
    await invoiceWithEwt(client.id, { status: "void", invoiceNo: "VOID-1" });
    const filed = await invoiceWithEwt(client.id, { invoiceNo: "FILED-1" });
    await pool.query("UPDATE invoices SET ewt_name = '2307.pdf', ewt_key = 'k' WHERE id = $1", [filed.id]);
    await invoiceWithEwt(client.id, { invoiceNo: "NOEWT-1", ewt: 0 });

    await runReminders("ewt", { force: true });

    const logged = (await pool.query("SELECT i.invoice_no FROM reminder_logs rl JOIN invoices i ON i.id = rl.invoice_id WHERE rl.type = 'ewt' ORDER BY i.invoice_no"))
      .rows.map((r) => r.invoice_no);
    expect(logged).toEqual(["PAID-1"]);
  });

  it("skip clients with no email on file and clients who collect in person", async () => {
    await enable();
    const noEmail = await createClientRow({ email: null });
    const inPerson = await createClientRow({ collectsInPerson: true });
    const reachable = await createClientRow();
    await invoiceWithEwt(noEmail.id);
    await invoiceWithEwt(inPerson.id);
    await invoiceWithEwt(reachable.id);

    const res = await runReminders("ewt", { force: true });
    expect(res.sent).toBe(1);
    expect((await sentTo())[0].client_id).toBe(reachable.id);
  });

  it("wait the configured number of days after the tax was recorded", async () => {
    await enable({ days_before: 7 });
    const client = await createClientRow();
    await invoiceWithEwt(client.id, { daysAgo: 3 });
    expect((await runReminders("ewt", { force: true })).sent).toBe(0);

    await pool.query("UPDATE invoice_payments SET verified_at = now() - interval '8 days'");
    expect((await runReminders("ewt", { force: true })).sent).toBe(1);
  });

  it("repeat only after the interval, and stop at the cap", async () => {
    await enable({ frequency_days: 14, max_reminders: 2 });
    const client = await createClientRow();
    await invoiceWithEwt(client.id);

    expect((await runReminders("ewt", { force: true })).sent).toBe(1);
    expect((await runReminders("ewt", { force: true })).sent).toBe(0); // too soon

    await pool.query("UPDATE reminder_logs SET sent_at = now() - interval '15 days'");
    expect((await runReminders("ewt", { force: true })).sent).toBe(1); // second

    await pool.query("UPDATE reminder_logs SET sent_at = now() - interval '15 days'");
    expect((await runReminders("ewt", { force: true })).sent).toBe(0); // capped at 2
    expect(await sentTo()).toHaveLength(2);
  });

  it("send one email per client for several invoices, with a link for each", async () => {
    await enable();
    const client = await createClientRow();
    await invoiceWithEwt(client.id, { invoiceNo: "SI-1" });
    await invoiceWithEwt(client.id, { invoiceNo: "SI-2" });
    const spy = vi.spyOn(emailLib, "sendMail");

    const res = await runReminders("ewt", { force: true });

    expect(res.sent).toBe(2);
    expect(spy).toHaveBeenCalledTimes(1);
    const [, subject, body] = spy.mock.calls[0] as [any, string, string];
    expect(subject).toContain("2 invoices");
    expect(body).toContain("SI-1");
    expect(body).toContain("SI-2");
    expect((body.match(/\/e\//g) || []).length).toBe(2);
    expect(await sentTo()).toHaveLength(2);
  });
});

describe("2307 reminder settings and preview", () => {
  it("can be edited by an admin, with the cap kept within 1 to 12", async () => {
    const admin = await createUser({ role: "admin" });
    const put = (body: object) =>
      request(app).put("/reminders/settings/ewt").set("Authorization", `Bearer ${tokenFor(admin)}`).send(body);

    const ok = await put({ days_before: 10, frequency_days: 7, max_reminders: 3, is_enabled: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ days_before: 10, frequency_days: 7, max_reminders: 3, is_enabled: true });
    expect((await put({ max_reminders: 0 })).status).toBe(400);
    expect((await put({ max_reminders: 13 })).status).toBe(400);
  });

  it("previews who would be emailed and who can't be reached, for admins only", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent" });
    const reachable = await createClientRow();
    await invoiceWithEwt(reachable.id);
    await invoiceWithEwt(reachable.id);
    await invoiceWithEwt((await createClientRow({ email: null })).id);
    await invoiceWithEwt((await createClientRow({ collectsInPerson: true })).id);

    const res = await request(app).get("/reminders/ewt-preview").set("Authorization", `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ due_invoices: 2, due_clients: 1, lacking_total: 4, lacking_no_email: 1, lacking_in_person: 1 });

    const denied = await request(app).get("/reminders/ewt-preview").set("Authorization", `Bearer ${tokenFor(agent)}`);
    expect(denied.status).toBe(403);
  });
});
