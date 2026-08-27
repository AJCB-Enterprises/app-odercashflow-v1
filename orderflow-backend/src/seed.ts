import bcrypt from "bcryptjs";
import { pool, one, tx } from "./db";
import { nextDocNo } from "./lib/numbering";

/**
 * Demo data for local development. Idempotent-ish: exits if the admin exists.
 * Logins — admin@ajcb.com.ph / admin-pass-123, rosa@orderflow.ph / agent-pass-123
 */
const run = async () => {
  if (await one("SELECT 1 FROM users WHERE email = 'admin@ajcb.com.ph'")) {
    console.log("Seed already applied — nothing to do.");
    await pool.end();
    return;
  }

  await tx(async (c) => {
    const hash = (p: string) => bcrypt.hashSync(p, 12);
    const admin = (
      await c.query(
        `INSERT INTO users (role, full_name, email, password_hash)
         VALUES ('admin', 'Site Admin', 'admin@ajcb.com.ph', $1) RETURNING id`,
        [hash("admin-pass-123")]
      )
    ).rows[0];

    const agent = async (name: string, email: string) =>
      (
        await c.query(
          `INSERT INTO users (role, full_name, email, password_hash)
           VALUES ('agent', $1, $2, $3) RETURNING id`,
          [name, email, hash("agent-pass-123")]
        )
      ).rows[0].id;
    const rosa = await agent("Rosa Lim", "rosa@orderflow.ph");
    const marco = await agent("Marco Deles", "marco@orderflow.ph");

    const client = async (company: string, contact: string, email: string, phone: string, agentId: string) =>
      (
        await c.query(
          `INSERT INTO clients (company_name, contact_name, email, phone, agent_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [company, contact, email, phone, agentId]
        )
      ).rows[0].id;
    const bayanihan = await client("Bayanihan Grocers", "Lito Ramos", "lito@bayanihan.ph", "0917 244 1122", rosa);
    const matina = await client("Matina Hardware", "Cora Villanueva", "cora@matinahw.ph", "0918 555 0341", rosa);
    const lanang = await client("Lanang Pharma Supply", "Ben Ocampo", "ben@lanangpharma.ph", "0917 880 7754", marco);

    // A pending order (shows up in the admin review queue + order reminders)
    const po1 = await nextDocNo(c, "PO");
    const order1 = (
      await c.query("INSERT INTO orders (order_no, client_id, created_by) VALUES ($1, $2, $3) RETURNING id", [
        po1,
        matina,
        rosa,
      ])
    ).rows[0].id;
    await c.query(
      `INSERT INTO order_items (order_id, description, qty, unit_price) VALUES
       ($1, 'Cement 40kg', 100, 265), ($1, 'Deformed bars 10mm', 200, 158)`,
      [order1]
    );

    // An approved order with an invoice due soon (payment reminder window)
    const po2 = await nextDocNo(c, "PO");
    const order2 = (
      await c.query(
        `INSERT INTO orders (order_no, client_id, created_by, status, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, 'approved', $4, now()) RETURNING id`,
        [po2, bayanihan, rosa, admin.id]
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO order_items (order_id, description, qty, unit_price) VALUES
       ($1, 'Rice 25kg sacks', 40, 1250), ($1, 'Cooking oil 1L', 120, 88)`,
      [order2]
    );
    const inv1 = await nextDocNo(c, "INV");
    await c.query(
      `INSERT INTO invoices (invoice_no, order_id, client_id, amount, due_date)
       VALUES ($1, $2, $3, 60560, CURRENT_DATE + 2)`,
      [inv1, order2, bayanihan]
    );

    // An overdue invoice (dashboard + reminders fire immediately)
    const inv2 = await nextDocNo(c, "INV");
    await c.query(
      `INSERT INTO invoices (invoice_no, client_id, amount, due_date)
       VALUES ($1, $2, 84200, CURRENT_DATE - 6)`,
      [inv2, lanang]
    );
  });

  console.log("Seeded. Logins: admin@ajcb.com.ph / admin-pass-123 · rosa@orderflow.ph / agent-pass-123");
  await pool.end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
