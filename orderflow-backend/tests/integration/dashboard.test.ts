import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
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
});
