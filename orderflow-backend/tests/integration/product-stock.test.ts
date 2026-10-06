import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { pool } from "../../src/db";
import { createClientRow, createOrder, createUser, tokenFor } from "../fixtures";

const addProduct = async (description: string, opts: { inStock?: boolean; active?: boolean } = {}) => {
  const { rows } = await pool.query(
    "INSERT INTO products (description, unit_price, in_stock, active) VALUES ($1, 100, $2, $3) RETURNING *",
    [description, opts.inStock ?? true, opts.active ?? true]
  );
  return rows[0];
};

describe("product stock flag", () => {
  it("defaults a new product to in stock", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ description: "Widget", unit_price: 10 });
    expect(res.status).toBe(201);
    expect(res.body.in_stock).toBe(true);
  });

  it("lets an admin with can_manage_products flip it, and shows it to agents", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent" });
    const product = await addProduct("Widget");

    const patch = await request(app)
      .patch(`/products/${product.id}`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ in_stock: false });
    expect(patch.status).toBe(200);
    expect(patch.body.in_stock).toBe(false);
    expect(patch.body.description).toBe("Widget");

    const list = await request(app).get("/products").set("Authorization", `Bearer ${tokenFor(agent)}`);
    expect(list.body.find((p: any) => p.id === product.id).in_stock).toBe(false);
  });

  it("blocks an admin without can_manage_products from flipping it", async () => {
    const admin = await createUser({ role: "admin", canManageProducts: false });
    const product = await addProduct("Widget");
    const res = await request(app)
      .patch(`/products/${product.id}`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ in_stock: false });
    expect(res.status).toBe(403);
  });
});

describe("out-of-stock flags on orders", () => {
  it("flags a matching line on order detail, ignoring case and surrounding spaces", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    await addProduct("Blue Widget", { inStock: false });
    const order = await createOrder({
      clientId: client.id,
      items: [
        { description: "  blue widget ", qty: 1, unit_price: 100 },
        { description: "Red Gadget", qty: 1, unit_price: 100 },
      ],
    });

    const res = await request(app).get(`/orders/${order.id}`).set("Authorization", `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    const byDesc = Object.fromEntries(res.body.items.map((it: any) => [it.description.trim().toLowerCase(), it.out_of_stock]));
    expect(byDesc["blue widget"]).toBe(true);
    expect(byDesc["red gadget"]).toBe(false);
  });

  it("does not flag an in-stock product, or an out-of-stock one that's been deactivated", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    await addProduct("In Stock Item", { inStock: true });
    await addProduct("Retired Item", { inStock: false, active: false });
    const order = await createOrder({
      clientId: client.id,
      items: [
        { description: "In Stock Item", qty: 1, unit_price: 100 },
        { description: "Retired Item", qty: 1, unit_price: 100 },
      ],
    });

    const res = await request(app).get(`/orders/${order.id}`).set("Authorization", `Bearer ${tokenFor(admin)}`);
    expect(res.body.items.every((it: any) => it.out_of_stock === false)).toBe(true);
  });

  it("marks a pending order in the list, but not an approved one", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await createClientRow();
    await addProduct("Scarce Item", { inStock: false });
    const items = [{ description: "Scarce Item", qty: 1, unit_price: 100 }];
    const pending = await createOrder({ clientId: client.id, status: "pending", items });
    const approved = await createOrder({ clientId: client.id, status: "approved", items });

    const res = await request(app).get("/orders").set("Authorization", `Bearer ${tokenFor(admin)}`);
    const flag = (id: string) => res.body.find((o: any) => o.id === id).has_out_of_stock;
    expect(flag(pending.id)).toBe(true);
    expect(flag(approved.id)).toBe(false);
  });
});
