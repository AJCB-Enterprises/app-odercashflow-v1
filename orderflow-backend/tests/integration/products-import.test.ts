import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { createUser, tokenFor } from "../fixtures";

describe("POST /products/import", () => {
  it("imports new products from a CSV with a header row", async () => {
    const admin = await createUser({ role: "admin" });
    const csv = "description,unit_price\nIndustrial Widget,250\nStandard Gadget,125.50\n";

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", Buffer.from(csv), { filename: "products.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.updated).toBe(0);
    expect(res.body.skipped).toEqual([]);

    const list = await request(app).get("/products").set("Authorization", `Bearer ${tokenFor(admin)}`);
    expect(list.body.some((p: any) => p.description === "Industrial Widget" && Number(p.unit_price) === 250)).toBe(true);
    expect(list.body.some((p: any) => p.description === "Standard Gadget" && Number(p.unit_price) === 125.5)).toBe(true);
  });

  it("works without a header row", async () => {
    const admin = await createUser({ role: "admin" });
    const csv = "Industrial Widget,250\n";

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", Buffer.from(csv), { filename: "products.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
  });

  it("updates the price and reactivates an existing product matched by description", async () => {
    const admin = await createUser({ role: "admin" });
    const created = await request(app).post("/products").set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ description: "Industrial Widget", unit_price: 200 });
    await request(app).patch(`/products/${created.body.id}`).set("Authorization", `Bearer ${tokenFor(admin)}`)
      .send({ active: false });

    const csv = "description,unit_price\nindustrial widget,275\n"; // case-insensitive match
    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", Buffer.from(csv), { filename: "products.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.updated).toBe(1);

    const list = await request(app).get("/products").set("Authorization", `Bearer ${tokenFor(admin)}`);
    const row = list.body.find((p: any) => p.id === created.body.id);
    expect(Number(row.unit_price)).toBe(275);
    expect(row.active).toBe(true);
  });

  it("skips malformed rows and reports why, without failing the whole import", async () => {
    const admin = await createUser({ role: "admin" });
    const csv = "description,unit_price\nGood Widget,100\n,50\nBad Price,notanumber\nToo,Many,Columns\n";

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", Buffer.from(csv), { filename: "products.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toHaveLength(3);
    expect(res.body.skipped.map((s: any) => s.line)).toEqual([3, 4, 5]);
  });

  it("handles quoted fields containing commas", async () => {
    const admin = await createUser({ role: "admin" });
    const csv = 'description,unit_price\n"Widget, Deluxe Edition",300\n';

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", Buffer.from(csv), { filename: "products.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    const list = await request(app).get("/products").set("Authorization", `Bearer ${tokenFor(admin)}`);
    expect(list.body.some((p: any) => p.description === "Widget, Deluxe Edition")).toBe(true);
  });

  it("handles a real Excel export: leading BOM, CRLF endings, and padded trailing empty columns", async () => {
    const admin = await createUser({ role: "admin" });
    const bom = "﻿";
    const csv =
      bom +
      "ECOBEST JRT (SGE) VP 200m 13gsm,1360,,,,,,,,,,,,,,,,,,,,,\r\n" +
      "ECONO JRT MG 170m 15 gsm,1120,,,,,,,,,,,,,,,,,,,,,\r\n";

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", Buffer.from(csv), { filename: "pricelist.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.skipped).toEqual([]);

    const list = await request(app).get("/products").set("Authorization", `Bearer ${tokenFor(admin)}`);
    // No leftover BOM character stuck to the first row's description.
    expect(list.body.some((p: any) => p.description === "ECOBEST JRT (SGE) VP 200m 13gsm")).toBe(true);
    expect(list.body.some((p: any) => p.description === "ECONO JRT MG 170m 15 gsm" && Number(p.unit_price) === 1120)).toBe(true);
  });

  it("still rejects a row with a genuine extra non-empty column, not just padding", async () => {
    const admin = await createUser({ role: "admin" });
    const csv = "Widget,100,extra-real-value\n";

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", Buffer.from(csv), { filename: "products.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.skipped).toEqual([{ line: 1, reason: "expected 2 columns (description, unit_price)" }]);
  });

  it("silently ignores fully-blank padded rows instead of reporting them as skipped", async () => {
    const admin = await createUser({ role: "admin" });
    const csv =
      "Widget,100,,,,,,,,,\r\n" +
      ",,,,,,,,,,,\r\n" +
      ",,,,,,,,,,,\r\n";

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", Buffer.from(csv), { filename: "products.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toEqual([]);
  });

  it("handles a tab-delimited file (a direct paste from Excel/Sheets saved as .csv)", async () => {
    const admin = await createUser({ role: "admin" });
    const csv = "ECOBEST JRT (SGE) VP 200m 13gsm\t₱1,360.00\nECOBEST JRT (SGE) VP 250m 13gsm\t₱1,440.00\nECONO JRT MG 170m 15 gsm\t₱1,120.00\n";

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", Buffer.from(csv), { filename: "products.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(3);
    expect(res.body.skipped).toEqual([]);

    const list = await request(app).get("/products").set("Authorization", `Bearer ${tokenFor(admin)}`);
    const row = list.body.find((p: any) => p.description === "ECOBEST JRT (SGE) VP 200m 13gsm");
    expect(Number(row.unit_price)).toBe(1360);
  });

  it("handles a tab-delimited header row too", async () => {
    const admin = await createUser({ role: "admin" });
    const csv = "description\tunit_price\nWidget\t₱1,000.00\n";

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", Buffer.from(csv), { filename: "products.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    const list = await request(app).get("/products").set("Authorization", `Bearer ${tokenFor(admin)}`);
    expect(list.body.some((p: any) => p.description === "Widget" && Number(p.unit_price) === 1000)).toBe(true);
  });

  it("still skips genuinely non-numeric prices rather than defaulting to 0", async () => {
    const admin = await createUser({ role: "admin" });
    const csv = "description,unit_price\nBad Widget,notanumber\n";

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", Buffer.from(csv), { filename: "products.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.skipped).toEqual([{ line: 2, reason: "invalid unit price" }]);
  });

  it("400s when no file is attached", async () => {
    const admin = await createUser({ role: "admin" });

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(400);
  });

  it("is blocked for an agent", async () => {
    const agent = await createUser({ role: "agent" });
    const csv = "description,unit_price\nWidget,100\n";

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${tokenFor(agent)}`)
      .attach("file", Buffer.from(csv), { filename: "products.csv", contentType: "text/csv" });

    expect(res.status).toBe(403);
  });

  it("is blocked for an admin without can_manage_products", async () => {
    const admin = await createUser({ role: "admin", canManageProducts: false });
    const csv = "description,unit_price\nWidget,100\n";

    const res = await request(app)
      .post("/products/import")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .attach("file", Buffer.from(csv), { filename: "products.csv", contentType: "text/csv" });

    expect(res.status).toBe(403);
  });
});
