import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { one, tx } from "../db";
import { resolveUploadToken } from "../lib/tokens";
import { saveEwtForm, saveReceipt, sanitizeFilename, validateUpload } from "../lib/storage";
import { notifyAdmins, notifyUser, audit } from "../lib/notify";
import { config } from "../config";

const setInvoiceEwt = (
  invoiceId: string,
  ewt: { key: string; name: string; mime: string; size: number },
  c: { query: (sql: string, params: any[]) => Promise<any> }
) =>
  c.query(
    `UPDATE invoices SET ewt_key = $2, ewt_name = $3, ewt_mime = $4, ewt_size_bytes = $5, ewt_submitted_at = now()
      WHERE id = $1`,
    [invoiceId, ewt.key, ewt.name, ewt.mime, ewt.size]
  );

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
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 2 },
});
const uploadFields = upload.fields([
  { name: "file", maxCount: 1 },
  { name: "ewt_file", maxCount: 1 },
]);
const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
});

const NOT_FOUND = { error: "This link is invalid or has expired. Please use the latest reminder email." };

/** GET /u/:token — the data behind the payment-receipt upload page. */
publicRouter.get("/u/:token", async (req, res) => {
  const inv = await resolveUploadToken(String(req.params.token), "receipt");
  if (!inv) return res.status(404).json(NOT_FOUND);
  res.json({
    invoice_no: inv.invoice_no,
    billed_to: inv.company_name,
    contact_name: inv.contact_name,
    // The remaining balance, not the original invoice total — a client who
    // already partly paid (e.g. net of EWT) should see what's still owed.
    amount: inv.balance_due,
    due_date: inv.due_date,
    status: inv.status, // 'receipt_uploaded' lets the page show "already received"
    is_overdue: inv.status === "unpaid" && new Date(inv.due_date) < new Date(),
    note: "This page records proof of payment only; it does not process the payment itself.",
  });
});

/**
 * POST /u/:token/receipt — multipart field "file" (required, JPG/PNG/PDF): the
 * payment receipt. Optional field "ewt_file" (same types): the client's BIR
 * Form 2307 (Certificate of Creditable Tax Withheld / EWT), if they withhold
 * tax on this payment. Both are validated and stored the same way.
 */
publicRouter.post("/u/:token/receipt", uploadLimiter, uploadFields, async (req, res) => {
  const inv = await resolveUploadToken(String(req.params.token), "receipt");
  if (!inv) return res.status(404).json(NOT_FOUND);
  if (inv.status === "paid" || inv.status === "void") return res.status(404).json(NOT_FOUND);

  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const receiptFile = files?.file?.[0];
  const ewtFile = files?.ewt_file?.[0];
  if (!receiptFile) return res.status(400).json({ error: "Attach a receipt file (JPG, PNG, or PDF)" });

  const kind = validateUpload(receiptFile);
  if (!kind) return res.status(400).json({ error: "Only JPG, PNG, or PDF receipts are accepted" });

  let ewtKind: { ext: string; mime: string } | null = null;
  if (ewtFile) {
    ewtKind = validateUpload(ewtFile);
    if (!ewtKind) return res.status(400).json({ error: "BIR Form 2307 must be a JPG, PNG, or PDF" });
  }

  const storageKey = await saveReceipt(inv.invoice_id, kind.ext, receiptFile.buffer);
  const originalName = sanitizeFilename(receiptFile.originalname, `receipt.${kind.ext}`);
  const ewtKey = ewtFile && ewtKind ? await saveEwtForm(inv.invoice_id, ewtKind.ext, ewtFile.buffer) : null;
  const ewtName = ewtFile && ewtKind ? sanitizeFilename(ewtFile.originalname, `2307.${ewtKind.ext}`) : null;

  await tx(async (c) => {
    await c.query(
      `INSERT INTO receipts (invoice_id, storage_key, original_name, mime_type, size_bytes, uploaded_via)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [inv.invoice_id, storageKey, originalName, kind.mime, receiptFile.size, inv.token_id]
    );
    if (ewtKey && ewtName && ewtKind && ewtFile)
      await setInvoiceEwt(inv.invoice_id, { key: ewtKey, name: ewtName, mime: ewtKind.mime, size: ewtFile.size }, c);
    await c.query("UPDATE invoices SET status = 'receipt_uploaded' WHERE id = $1 AND status = 'unpaid'", [
      inv.invoice_id,
    ]);
    await notifyAdmins(
      `${inv.company_name} uploaded a receipt for ${inv.invoice_no} (${originalName})${ewtName ? ", with a BIR 2307 form" : ""}.`,
      `/invoices/${inv.invoice_id}`,
      c
    );
    const agent = await one<{ agent_id: string }>(
      "SELECT c.agent_id FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = $1",
      [inv.invoice_id]
    );
    if (agent?.agent_id)
      await notifyUser(agent.agent_id, `${inv.company_name} uploaded a payment receipt for ${inv.invoice_no}.`, `/invoices/${inv.invoice_id}`, c);
    await audit(null, "receipt.uploaded", "invoice", inv.invoice_id, { via_token: inv.token_id, file: originalName, ewt_file: ewtName }, c);
  });

  res.status(201).json({
    ok: true,
    message: `Receipt received for ${inv.invoice_no}. The billing team will verify it and mark the invoice paid.`,
  });
});

const EWT_NOT_FOUND = { error: "This link is invalid or has expired. Please ask your billing contact for a new one." };

/** GET /e/:token — the data behind the standalone BIR 2307 (EWT) upload page. */
publicRouter.get("/e/:token", async (req, res) => {
  const inv = await resolveUploadToken(String(req.params.token), "ewt");
  if (!inv) return res.status(404).json(EWT_NOT_FOUND);
  res.json({
    invoice_no: inv.invoice_no,
    billed_to: inv.company_name,
    contact_name: inv.contact_name,
    already_submitted: !!inv.ewt_name,
    note: "This page is only for submitting BIR Form 2307. It does not affect your invoice's payment status.",
  });
});

/**
 * POST /e/:token — multipart field "file" (required, JPG/PNG/PDF): the
 * client's BIR Form 2307. Unlike the payment-receipt link, this stays valid
 * even after the invoice is fully paid — it's meant for clients who settle
 * payment first and send the form later.
 */
publicRouter.post("/e/:token", uploadLimiter, uploadSingle.single("file"), async (req, res) => {
  const inv = await resolveUploadToken(String(req.params.token), "ewt");
  if (!inv) return res.status(404).json(EWT_NOT_FOUND);
  if (inv.status === "void") return res.status(404).json(EWT_NOT_FOUND);
  if (!req.file) return res.status(400).json({ error: "Attach your BIR Form 2307 (JPG, PNG, or PDF)" });

  const kind = validateUpload(req.file);
  if (!kind) return res.status(400).json({ error: "BIR Form 2307 must be a JPG, PNG, or PDF" });

  const ewtKey = await saveEwtForm(inv.invoice_id, kind.ext, req.file.buffer);
  const ewtName = sanitizeFilename(req.file.originalname, `2307.${kind.ext}`);

  await tx(async (c) => {
    await setInvoiceEwt(inv.invoice_id, { key: ewtKey, name: ewtName, mime: kind.mime, size: req.file!.size }, c);
    await notifyAdmins(`${inv.company_name} submitted a BIR 2307 form for ${inv.invoice_no}.`, `/invoices/${inv.invoice_id}`, c);
    await audit(null, "ewt.uploaded", "invoice", inv.invoice_id, { via_token: inv.token_id, file: ewtName }, c);
  });

  res.status(201).json({
    ok: true,
    message: `BIR Form 2307 received for ${inv.invoice_no}. Thank you.`,
  });
});
