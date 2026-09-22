import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { createUser, tokenFor } from "../fixtures";

const baseClient = {
  company_name: "Alpha Trading Co.",
  contact_name: "Jam",
  email: "jam@alpha.test",
  phone: "0917 111 2222",
  address: "Davao City",
  tin: "123-456-789-000",
};

describe("POST /clients — duplicate flagging", () => {
  it("flags an exact (case/whitespace-insensitive) company name match", async () => {
    const admin = await createUser({ role: "admin" });
    const token = tokenFor(admin);
    const first = await request(app).post("/clients").set("Authorization", `Bearer ${token}`).send(baseClient);
    expect(first.status).toBe(201);

    const res = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ...baseClient,
        company_name: "  alpha   trading co.  ", // different case/spacing, same name
        email: "different@example.test",
        phone: "0918 000 0000",
        tin: "999-999-999-000",
      });

    expect(res.status).toBe(409);
    expect(res.body.matches).toHaveLength(1);
    expect(res.body.matches[0].reasons).toContain("company_name");
    expect(res.body.matches[0].company_name).toBe("Alpha Trading Co.");
  });

  it("flags a TIN match regardless of dash formatting", async () => {
    const admin = await createUser({ role: "admin" });
    const token = tokenFor(admin);
    await request(app).post("/clients").set("Authorization", `Bearer ${token}`).send(baseClient);

    const res = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ...baseClient,
        company_name: "Alpha Trading — Branch 2",
        email: "branch2@alpha.test",
        phone: "0918 000 0000",
        tin: "123456789000", // same digits, no dashes
      });

    expect(res.status).toBe(409);
    expect(res.body.matches[0].reasons).toContain("tin");
  });

  it("flags an email match case-insensitively", async () => {
    const admin = await createUser({ role: "admin" });
    const token = tokenFor(admin);
    await request(app).post("/clients").set("Authorization", `Bearer ${token}`).send(baseClient);

    const res = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ...baseClient,
        company_name: "Totally Different Co.",
        email: "JAM@ALPHA.TEST",
        phone: "0918 000 0000",
        tin: "999-999-999-000",
      });

    expect(res.status).toBe(409);
    expect(res.body.matches[0].reasons).toContain("email");
  });

  it("flags a phone match regardless of formatting", async () => {
    const admin = await createUser({ role: "admin" });
    const token = tokenFor(admin);
    await request(app).post("/clients").set("Authorization", `Bearer ${token}`).send(baseClient);

    const res = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ...baseClient,
        company_name: "Totally Different Co.",
        email: "different@example.test",
        phone: "(0917) 111-2222",
        tin: "999-999-999-000",
      });

    expect(res.status).toBe(409);
    expect(res.body.matches[0].reasons).toContain("phone");
  });

  it("creates the client anyway when confirm_duplicate is set", async () => {
    const admin = await createUser({ role: "admin" });
    const token = tokenFor(admin);
    await request(app).post("/clients").set("Authorization", `Bearer ${token}`).send(baseClient);

    const res = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...baseClient, confirm_duplicate: true });

    expect(res.status).toBe(201);
  });

  it("does not flag an unrelated client", async () => {
    const admin = await createUser({ role: "admin" });
    const token = tokenFor(admin);
    await request(app).post("/clients").set("Authorization", `Bearer ${token}`).send(baseClient);

    const res = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        company_name: "Bravo Grocers",
        contact_name: "Ana",
        email: "ana@bravo.test",
        phone: "0920 333 4444",
        address: "Davao City",
        tin: "555-555-555-000",
      });

    expect(res.status).toBe(201);
  });

  it("flags duplicates for an agent creating a client too, not just admin", async () => {
    const agent = await createUser({ role: "agent" });
    const token = tokenFor(agent);
    await request(app).post("/clients").set("Authorization", `Bearer ${token}`).send(baseClient);

    const res = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...baseClient, tin: "999-999-999-000" }); // same company name

    expect(res.status).toBe(409);
    expect(res.body.matches[0].reasons).toContain("company_name");
  });

  it("keeps the flagged match response minimal — no contact details beyond id and company name", async () => {
    const admin = await createUser({ role: "admin" });
    const token = tokenFor(admin);
    await request(app).post("/clients").set("Authorization", `Bearer ${token}`).send(baseClient);

    const res = await request(app)
      .post("/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...baseClient, tin: "999-999-999-000" });

    expect(res.status).toBe(409);
    expect(Object.keys(res.body.matches[0]).sort()).toEqual(["company_name", "id", "reasons"]);
  });
});
