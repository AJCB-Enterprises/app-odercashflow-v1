import { describe, expect, it } from "vitest";
import { pool } from "../../src/db";
import { runReminders } from "../../src/worker/reminders";
import { createClientRow, createOrder } from "../fixtures";

describe("order reminders — disabled by default", () => {
  it("sends nothing for a still-pending order, even forced", async () => {
    const client = await createClientRow();
    const order = await createOrder({
      clientId: client.id, status: "pending",
      items: [{ description: "Widget", qty: 1, unit_price: 100 }],
    });

    const result = await runReminders("order", { force: true });

    expect(result.sent).toBe(0);
    expect(result.skipped_reason).toBe("disabled");

    const { rows } = await pool.query(
      "SELECT * FROM reminder_logs WHERE type = 'order' AND order_id = $1",
      [order.id]
    );
    expect(rows).toHaveLength(0);
  });

  it("is off by default in reminder_settings", async () => {
    const { rows } = await pool.query("SELECT is_enabled FROM reminder_settings WHERE type = 'order'");
    expect(rows[0].is_enabled).toBe(false);
  });
});
