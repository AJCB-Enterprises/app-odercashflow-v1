import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import { createClientRow, createInvoice, createUser, tokenFor } from "../fixtures";

const fakePdf = Buffer.from("%PDF-1.4\nfake 2307 content for testing\n");

describe("POST /invoices/:id/ewt — admin uploads a BIR 2307 in person", () => {
  it("uploads the form and marks it submitted", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/ewt`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", fakePdf, { filename: "2307.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    expect(res.body.ewt_name).toBe("2307.pdf");

    const { rows } = await pool.query(
      "SELECT ewt_key, ewt_name, ewt_mime, ewt_submitted_at FROM invoices WHERE id = $1",
      [invoice.id]
    );
    expect(rows[0].ewt_key).toBeTruthy();
    expect(rows[0].ewt_name).toBe("2307.pdf");
    expect(rows[0].ewt_mime).toBe("application/pdf");
    expect(rows[0].ewt_submitted_at).not.toBeNull();
  });

  it("replaces whatever was already on file", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });
    await request(app)
      .post(`/invoices/${invoice.id}/ewt`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", fakePdf, { filename: "first.pdf", contentType: "application/pdf" });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/ewt`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", fakePdf, { filename: "second.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    const { rows } = await pool.query("SELECT ewt_name FROM invoices WHERE id = $1", [invoice.id]);
    expect(rows[0].ewt_name).toBe("second.pdf");
  });

  it("works even on an already-paid invoice", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000, status: "paid" });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/ewt`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", fakePdf, { filename: "2307.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
  });

  it("404s for a void invoice", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000, status: "void" });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/ewt`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", fakePdf, { filename: "2307.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(404);
  });

  it("404s for a nonexistent invoice", async () => {
    const admin = await createUser({ role: "admin" });

    const res = await request(app)
      .post(`/invoices/00000000-0000-0000-0000-000000000000/ewt`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", fakePdf, { filename: "2307.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(404);
  });

  it("400s when no file is attached", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/ewt`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(400);
  });

  it("rejects a file whose content doesn't match its declared type", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/ewt`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", Buffer.from("not actually a pdf"), { filename: "2307.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(400);
  });

  it("is admin-only — an agent gets 403", async () => {
    const agent = await createUser({ role: "agent" });
    const client = await createClientRow();
    const invoice = await createInvoice({ clientId: client.id, amount: 1000 });

    const res = await request(app)
      .post(`/invoices/${invoice.id}/ewt`)
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .attach("file", fakePdf, { filename: "2307.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(403);
  });
});
