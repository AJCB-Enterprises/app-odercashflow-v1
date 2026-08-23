import { Router } from "express";
import { q } from "../db";
import { requireAuth } from "../middleware/auth";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/** GET /notifications — the signed-in user's feed, unread first. */
notificationsRouter.get("/", async (req, res) => {
  const rows = await q(
    `SELECT id, body, link_path, read_at, created_at
       FROM notifications WHERE user_id = $1
      ORDER BY (read_at IS NULL) DESC, created_at DESC LIMIT 100`,
    [req.user!.id]
  );
  res.json(rows);
});

/** POST /notifications/read-all */
notificationsRouter.post("/read-all", async (req, res) => {
  await q("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [req.user!.id]);
  res.json({ ok: true });
});
