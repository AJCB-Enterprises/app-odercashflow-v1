import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { createClientRow, createInvoice, createOrder, createUser, tokenFor } from "../fixtures";

describe("POST /orders/:id/approve — duplicate Sales Invoice numbers", () => {
  it("rejects an exact duplicate invoice number", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    await createInvoice({ clientId: client.id, amount: 100, invoiceNo: "SI-2026-0001" });
    const order = await createOrder({ clientId: client.id });

    const res = await request(app)
      .post(`/orders/${order.id}/approve`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ invoice_no: "SI-2026-0001" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in use/i);
  });

  it("rejects a duplicate that only differs by case", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    await createInvoice({ clientId: client.id, amount: 100, invoiceNo: "SI-2026-0002" });
    const order = await createOrder({ clientId: client.id });

    const res = await request(app)
      .post(`/orders/${order.id}/approve`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ invoice_no: "si-2026-0002" });

    expect(res.status).toBe(409);
  });

  it("accepts a genuinely new invoice number", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    const order = await createOrder({ clientId: client.id });

    const res = await request(app)
      .post(`/orders/${order.id}/approve`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ invoice_no: "SI-2026-0099" });

    expect(res.status).toBe(200);
    expect(res.body.invoice.invoice_no).toBe("SI-2026-0099");
  });
});
