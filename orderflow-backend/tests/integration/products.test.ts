import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { createUser, tokenFor } from "../fixtures";

describe("POST /products", () => {
  it("lets admin add a product", async () => {
    const admin = await createUser({ role: "admin" });

    const res = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ description: "Industrial Widget", unit_price: 250 });

    expect(res.status).toBe(201);
    expect(res.body.description).toBe("Industrial Widget");
    expect(Number(res.body.unit_price)).toBe(250);
    expect(res.body.active).toBe(true);
  });

  it("is blocked for an agent", async () => {
    const agent = await createUser({ role: "agent" });

    const res = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .send({ description: "Industrial Widget", unit_price: 250 });

    expect(res.status).toBe(403);
  });

  it("is blocked for an admin without can_manage_products", async () => {
    const admin = await createUser({ role: "admin", canManageProducts: false });

    const res = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ description: "Industrial Widget", unit_price: 250 });

    expect(res.status).toBe(403);
  });

  it("rejects a blank description", async () => {
    const admin = await createUser({ role: "admin" });

    const res = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ description: "  ", unit_price: 250 });

    expect(res.status).toBe(400);
  });

  it("rejects a negative price", async () => {
    const admin = await createUser({ role: "admin" });

    const res = await request(app)
      .post("/products")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ description: "Widget", unit_price: -5 });

    expect(res.status).toBe(400);
  });
});

describe("GET /products", () => {
  it("an agent can read the price list", async () => {
    const admin = await createUser({ role: "admin" });
    await request(app).post("/products").set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ description: "Widget", unit_price: 100 });

    const agent = await createUser({ role: "agent" });
    const res = await request(app).get("/products").set("Authorization", `Bearer ${tokenFor(agent)}`);

    expect(res.status).toBe(200);
    expect(res.body.some((p: any) => p.description === "Widget")).toBe(true);
  });
});

describe("PATCH /products/:id", () => {
  it("lets admin edit price and description", async () => {
    const admin = await createUser({ role: "admin" });
    const created = await request(app).post("/products").set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ description: "Widget", unit_price: 100 });

    const res = await request(app)
      .patch(`/products/${created.body.id}`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ description: "Deluxe Widget", unit_price: 150 });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe("Deluxe Widget");
    expect(Number(res.body.unit_price)).toBe(150);
  });

  it("lets admin deactivate and reactivate a product", async () => {
    const admin = await createUser({ role: "admin" });
    const created = await request(app).post("/products").set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ description: "Widget", unit_price: 100 });

    const off = await request(app)
      .patch(`/products/${created.body.id}`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);

    const on = await request(app)
      .patch(`/products/${created.body.id}`)
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ active: true });
    expect(on.body.active).toBe(true);
  });

  it("is blocked for an agent", async () => {
    const admin = await createUser({ role: "admin" });
    const created = await request(app).post("/products").set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ description: "Widget", unit_price: 100 });

    const agent = await createUser({ role: "agent" });
    const res = await request(app)
      .patch(`/products/${created.body.id}`)
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .send({ unit_price: 999 });

    expect(res.status).toBe(403);
  });

  it("is blocked for an admin without can_manage_products", async () => {
    const admin = await createUser({ role: "admin" });
    const created = await request(app).post("/products").set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ description: "Widget", unit_price: 100 });

    const restrictedAdmin = await createUser({ role: "admin", canManageProducts: false });
    const res = await request(app)
      .patch(`/products/${created.body.id}`)
      .set("Authorization", `Bearer ${tokenFor(restrictedAdmin)}`)
      .send({ unit_price: 999 });

    expect(res.status).toBe(403);
  });

  it("404s for an unknown product id", async () => {
    const admin = await createUser({ role: "admin" });

    const res = await request(app)
      .patch("/products/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ unit_price: 999 });

    expect(res.status).toBe(404);
  });
});

describe("GET /products with a restricted admin", () => {
  it("is still readable by an admin without can_manage_products (read-only, for the picker)", async () => {
    const admin = await createUser({ role: "admin" });
    await request(app).post("/products").set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ description: "Widget", unit_price: 100 });

    const restrictedAdmin = await createUser({ role: "admin", canManageProducts: false });
    const res = await request(app).get("/products").set("Authorization", `Bearer ${tokenFor(restrictedAdmin)}`);

    expect(res.status).toBe(200);
    expect(res.body.some((p: any) => p.description === "Widget")).toBe(true);
  });
});
