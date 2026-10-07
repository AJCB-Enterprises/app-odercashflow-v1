import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { createClientRow, createUser, tokenFor } from "../fixtures";

const items = JSON.stringify([{ description: "Widget", qty: 1, unit_price: 100 }]);

const setup = async () => {
  const agent = await createUser({ role: "agent" });
  const admin = await createUser({ role: "admin" });
  const client = await createClientRow({ agentId: agent.id });
  return { agent, admin, client, agentToken: tokenFor(agent), adminToken: tokenFor(admin) };
};

const create = (token: string, clientId: string, remarks?: string) => {
  const r = request(app).post("/orders").set("Authorization", `Bearer ${token}`).field("client_id", clientId).field("items", items);
  return remarks === undefined ? r : r.field("remarks", remarks);
};

const revise = (token: string, orderId: string, fields: Record<string, string>) => {
  let r = request(app).patch(`/orders/${orderId}`).set("Authorization", `Bearer ${token}`).field("items", items);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r;
};

describe("order remarks", () => {
  it("are saved when an agent creates an order, and visible to the admin reviewing it", async () => {
    const { client, agentToken, adminToken } = await setup();
    const res = await create(agentToken, client.id, "  Deliver after 2pm, ask for Mang Jun.  ");
    expect(res.status).toBe(201);
    expect(res.body.remarks).toBe("Deliver after 2pm, ask for Mang Jun.");

    const detail = await request(app).get(`/orders/${res.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.order.remarks).toBe("Deliver after 2pm, ask for Mang Jun.");
  });

  it("are optional, and a blank value is stored as none", async () => {
    const { client, agentToken } = await setup();
    expect((await create(agentToken, client.id)).body.remarks).toBeNull();
    expect((await create(agentToken, client.id, "   ")).body.remarks).toBeNull();
  });

  it("are capped at 2000 characters", async () => {
    const { client, agentToken } = await setup();
    expect((await create(agentToken, client.id, "x".repeat(2000))).status).toBe(201);
    expect((await create(agentToken, client.id, "x".repeat(2001))).status).toBe(400);
  });

  it("can be changed or cleared while the order is pending", async () => {
    const { client, agentToken } = await setup();
    const order = (await create(agentToken, client.id, "first note")).body;

    const changed = await revise(agentToken, order.id, { remarks: "updated note" });
    expect(changed.status).toBe(200);
    expect(changed.body.remarks).toBe("updated note");

    const cleared = await revise(agentToken, order.id, { remarks: "" });
    expect(cleared.body.remarks).toBeNull();
  });

  it("are kept when an edit doesn't mention them, such as admin removing an item", async () => {
    const { client, agentToken, adminToken } = await setup();
    const order = (await create(agentToken, client.id, "keep me")).body;

    const res = await revise(adminToken, order.id, {});
    expect(res.status).toBe(200);
    expect(res.body.remarks).toBe("keep me");
  });
});
