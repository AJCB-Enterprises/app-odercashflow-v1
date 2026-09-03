import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { createUser, tokenFor } from "../fixtures";
import { pool } from "../../src/db";

describe("client TIN encryption", () => {
  it("stores TIN encrypted at rest but returns it decrypted through the API", async () => {
    const admin = await createUser({ role: "admin" });
    const token = tokenFor(admin);

    const create = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        company_name: "Acme Corp",
        contact_name: "Jam",
        email: "jam@acme.test",
        phone: "0917 000 0000",
        address: "Davao City",
        tin: "123-456-789-000",
      });

    expect(create.status).toBe(201);
    expect(create.body.tin).toBe("123-456-789-000");

    const { rows } = await pool.query("SELECT tin FROM clients WHERE id = $1", [create.body.id]);
    expect(rows[0].tin).not.toBe("123-456-789-000");
    expect(rows[0].tin).toMatch(/^enc:v1:/);

    const get = await request(app).get(`/clients/${create.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(get.body.client.tin).toBe("123-456-789-000");
  });

  it("re-encrypts TIN on update rather than storing it in plaintext", async () => {
    const admin = await createUser({ role: "admin" });
    const token = tokenFor(admin);
    const create = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        company_name: "Acme Corp",
        contact_name: "Jam",
        email: "jam@acme.test",
        phone: "0917 000 0000",
        address: "Davao City",
        tin: "111-111-111-000",
      });

    const update = await request(app)
      .patch(`/clients/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tin: "987-654-321-000" });

    expect(update.body.tin).toBe("987-654-321-000");
    const { rows } = await pool.query("SELECT tin FROM clients WHERE id = $1", [create.body.id]);
    expect(rows[0].tin).toMatch(/^enc:v1:/);
  });

  it("never writes the plaintext TIN into the audit log", async () => {
    const admin = await createUser({ role: "admin" });
    const token = tokenFor(admin);
    const create = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        company_name: "Acme Corp",
        contact_name: "Jam",
        email: "jam@acme.test",
        phone: "0917 000 0000",
        address: "Davao City",
        tin: "111-111-111-000",
      });

    await request(app)
      .patch(`/clients/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tin: "987-654-321-000" });

    const { rows } = await pool.query(
      "SELECT detail FROM audit_log WHERE action = 'client.updated' AND entity_id = $1",
      [create.body.id]
    );
    expect(JSON.stringify(rows[0].detail)).not.toContain("987-654-321-000");
  });
});
