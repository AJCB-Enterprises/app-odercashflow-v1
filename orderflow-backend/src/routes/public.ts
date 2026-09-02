import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { one, tx } from "../db";
import { resolveUploadToken } from "../lib/tokens";
import { saveReceipt, sanitizeFilename, validateUpload } from "../lib/storage";
import { notifyAdmins, notifyUser, audit } from "../lib/notify";
import { config } from "../config";

/**
 * Public, token-authenticated routes for the client upload page.
 * The token in the URL is the credential (see architecture §2.1):
 *  - missing, expired, revoked, and unknown tokens all return the same 404
 *  - responses expose the minimum: invoice no, display name, amount, due date
 *  - rate-limited by IP; uploads validated by MIME type, extension, and magic bytes
 */
export const publicRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  message: { error: "Too many requests, try again later" },
});
publicRouter.use(limiter);

// Tighter limit specifically on the upload action — it costs disk I/O, a DB
// write, and admin/agent notification emails, unlike the plain GET above.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  message: { error: "Too many upload attempts, try again later" },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
});

const NOT_FOUND = { error: "This link is invalid or has expired. Please use the latest reminder email." };

/** GET /u/:token — the data behind the upload page. */
publicRouter.get("/u/:token", async (req, res) => {
  const inv = await resolveUploadToken(String(req.params.token));
  if (!inv) return res.status(404).json(NOT_FOUND);
  res.json({
    invoice_no: inv.invoice_no,
    billed_to: inv.company_name,
    contact_name: inv.contact_name,
    amount: inv.amount,
    due_date: inv.due_date,
    status: inv.status, // 'receipt_uploaded' lets the page show "already received"
    is_overdue: inv.status === "unpaid" && new Date(inv.due_date) < new Date(),
    note: "This page records proof of payment only; it does not process the payment itself.",
  });
});

/** POST /u/:token/receipt — multipart field "file": JPG, PNG, or PDF. */
publicRouter.post("/u/:token/receipt", uploadLimiter, upload.single("file"), async (req, res) => {
  const inv = await resolveUploadToken(String(req.params.token));
  if (!inv) return res.status(404).json(NOT_FOUND);
  if (inv.status === "paid" || inv.status === "void") return res.status(404).json(NOT_FOUND);
  if (!req.file) return res.status(400).json({ error: "Attach a receipt file (JPG, PNG, or PDF)" });

  const kind = validateUpload(req.file);
  if (!kind) return res.status(400).json({ error: "Only JPG, PNG, or PDF receipts are accepted" });

  const storageKey = await saveReceipt(inv.invoice_id, kind.ext, req.file.buffer);
  const originalName = sanitizeFilename(req.file.originalname, `receipt.${kind.ext}`);

  await tx(async (c) => {
    await c.query(
      `INSERT INTO receipts (invoice_id, storage_key, original_name, mime_type, size_bytes, uploaded_via)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [inv.invoice_id, storageKey, originalName, kind.mime, req.file!.size, inv.token_id]
    );
    await c.query("UPDATE invoices SET status = 'receipt_uploaded' WHERE id = $1 AND status = 'unpaid'", [
      inv.invoice_id,
    ]);
    await notifyAdmins(
      `${inv.company_name} uploaded a receipt for ${inv.invoice_no} (${originalName}).`,
      `/invoices/${inv.invoice_id}`,
      c
    );
    const agent = await one<{ agent_id: string }>(
      "SELECT c.agent_id FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = $1",
      [inv.invoice_id]
    );
    if (agent?.agent_id)
      await notifyUser(agent.agent_id, `${inv.company_name} uploaded a payment receipt for ${inv.invoice_no}.`, `/invoices/${inv.invoice_id}`, c);
    await audit(null, "receipt.uploaded", "invoice", inv.invoice_id, { via_token: inv.token_id, file: originalName }, c);
  });

  res.status(201).json({
    ok: true,
    message: `Receipt received for ${inv.invoice_no}. The billing team will verify it and mark the invoice paid.`,
  });
});
