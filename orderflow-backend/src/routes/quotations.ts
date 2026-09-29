import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { one, q, tx } from "../db";
import { clientScopeSql, requireAgentPermission, requireAuth } from "../middleware/auth";
import { nextDocNo, peso, shortDate } from "../lib/numbering";
import { audit } from "../lib/notify";
import { clientEmails, sendMail } from "../lib/email";
import { config } from "../config";

export const quotationsRouter = Router();
quotationsRouter.use(requireAuth);

// Same bound as order creation — a quotation costs an outbound email too.
const createQuotationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  message: { error: "Too many quotations submitted, try again later" },
});

const PAYMENT_TERM_LABELS: Record<string, string> = { net_15: "Net 15", net_30: "Net 30", net_45: "Net 45", cod: "COD" };
const VAT_STATUS_LABELS: Record<string, string> = { vat_exempt: "SO/ DR", vat_inclusive: "VAT-Inclusive", zero_rated: "Zero-Rated" };

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The HTML counterpart to the quotation's plain-text email — table-based
 * layout and inline styles throughout (no <style> block, no flexbox/grid),
 * since that's what actually renders consistently across email clients,
 * Outlook included. The logo is a normal <img> pointed at this server's own
 * public, unauthenticated /assets route — email clients fetch images over
 * plain HTTP(S), they can't reach anything behind a JWT.
 */
const quotationEmailHtml = (opts: {
  contactName: string;
  quoteNo: string;
  items: { description: string; qty: number; unit_price: number }[];
  subtotal: number;
  vatStatus: string;
  paymentTerms: string;
  validUntil: string;
  agentName: string;
}) => {
  const logoUrl = `${config.publicBaseUrl}/assets/logo.png`;
  const itemRows = opts.items
    .map(
      (it) => `
              <tr>
                <td style="padding:8px 10px;font-size:14px;color:#1C2333;border-bottom:1px solid #EFEEE7;">${escapeHtml(it.description)}</td>
                <td align="right" style="padding:8px 10px;font-size:14px;color:#1C2333;border-bottom:1px solid #EFEEE7;">${it.qty}</td>
                <td align="right" style="padding:8px 10px;font-size:14px;color:#1C2333;border-bottom:1px solid #EFEEE7;">${peso(it.unit_price)}</td>
                <td align="right" style="padding:8px 10px;font-size:14px;color:#1C2333;border-bottom:1px solid #EFEEE7;">${peso(it.qty * it.unit_price)}</td>
              </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#F4F5F1;font-family:Arial,Helvetica,sans-serif;color:#1C2333;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F1;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #DEE1D9;border-radius:6px;">
            <tr>
              <td style="padding:28px 32px 20px;border-bottom:3px solid #1E6E52;">
                <img src="${logoUrl}" alt="AJCB Enterprises Inc." width="180" style="display:block;border:0;">
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px;">
                <p style="margin:0 0 16px;font-size:15px;">Hi ${escapeHtml(opts.contactName)},</p>
                <p style="margin:0 0 20px;font-size:15px;">Please find our quotation <strong>${opts.quoteNo}</strong> below.</p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
                  <tr style="background:#F4F5F1;">
                    <td style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#525A6B;border-bottom:1px solid #DEE1D9;">Item</td>
                    <td align="right" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#525A6B;border-bottom:1px solid #DEE1D9;">Qty</td>
                    <td align="right" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#525A6B;border-bottom:1px solid #DEE1D9;">Unit ₱</td>
                    <td align="right" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#525A6B;border-bottom:1px solid #DEE1D9;">Total</td>
                  </tr>${itemRows}
                  <tr>
                    <td colspan="3" style="padding:10px;font-size:14px;font-weight:bold;text-align:right;border-top:2px solid #1C2333;">Total</td>
                    <td align="right" style="padding:10px;font-size:14px;font-weight:bold;border-top:2px solid #1C2333;">${peso(opts.subtotal)}</td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                  <tr>
                    <td style="padding:4px 0;font-size:13px;color:#525A6B;">VAT treatment</td>
                    <td align="right" style="padding:4px 0;font-size:13px;">${VAT_STATUS_LABELS[opts.vatStatus]}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;font-size:13px;color:#525A6B;">Payment terms</td>
                    <td align="right" style="padding:4px 0;font-size:13px;">${PAYMENT_TERM_LABELS[opts.paymentTerms]}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;font-size:13px;color:#525A6B;">Valid until</td>
                    <td align="right" style="padding:4px 0;font-size:13px;">${shortDate(opts.validUntil)}</td>
                  </tr>
                </table>

                <p style="margin:0 0 20px;font-size:13px;color:#525A6B;font-style:italic;">
                  This is a quotation only, not an invoice or a confirmed order. Please reach out to your AJCB representative if you'd like to proceed.
                </p>

                <p style="margin:0;font-size:15px;">Thank you,<br>${escapeHtml(opts.agentName)}<br>AJCB Enterprises</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

/** GET /quotations — admin sees every quotation; an agent sees only their own clients'. */
quotationsRouter.get("/", async (req, res) => {
  const user = req.user!;
  const params: any[] = [];
  const scope = clientScopeSql(user, "c", params.length + 1);
  if (scope.param) params.push(scope.param);

  const rows = await q(
    `SELECT qt.id, qt.quote_no, qt.payment_terms, qt.vat_status, qt.valid_until, qt.sent_at, qt.created_at,
            c.id AS client_id, c.company_name,
            u.full_name AS agent_name,
            coalesce(sum(qi.qty * qi.unit_price), 0) AS total,
            (SELECT json_agg(json_build_object('description', description, 'qty', qty, 'unit_price', unit_price))
               FROM quotation_items qi2 WHERE qi2.quotation_id = qt.id) AS items
       FROM quotations qt
       JOIN clients c ON c.id = qt.client_id
       LEFT JOIN users u ON u.id = qt.created_by
       LEFT JOIN quotation_items qi ON qi.quotation_id = qt.id
      WHERE TRUE${scope.sql}
      GROUP BY qt.id, c.id, u.full_name
      ORDER BY qt.created_at DESC`,
    params
  );
  res.json(rows);
});

const QuotationBody = z.object({
  client_id: z.string().uuid(),
  items: z
    .array(
      z.object({
        description: z.string().min(1),
        qty: z.number().positive(),
        unit_price: z.number().nonnegative(),
      })
    )
    .min(1),
  payment_terms: z.enum(["net_15", "net_30", "net_45", "cod"]),
  vat_status: z.enum(["vat_exempt", "vat_inclusive", "zero_rated"]),
  valid_until: z.string().date(),
});

/**
 * POST /quotations — agent drafts a price quotation for an assigned client
 * (admin can quote for any client) and it's emailed immediately to every
 * address on file for that client. Simpler than a Sales Order on purpose:
 * no PO reference, no admin approval step, and — for now — no public
 * accept/decline page or path to convert it into a real order.
 *
 * The quotation record is created even if the email fails to send (mail
 * failure shouldn't erase the draft) — the response's `sent` flag tells the
 * caller whether it actually went out.
 */
quotationsRouter.post("/", requireAgentPermission("can_create_po"), createQuotationLimiter, async (req, res) => {
  const user = req.user!;
  const parsed = QuotationBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { client_id, items, payment_terms, vat_status, valid_until } = parsed.data;

  const clientRow = await one<{
    id: string; company_name: string; contact_name: string;
    email: string | null; extra_emails: string[]; agent_id: string | null;
  }>(
    "SELECT id, company_name, contact_name, email, extra_emails, agent_id FROM clients WHERE id = $1",
    [client_id]
  );
  if (!clientRow || (user.role === "agent" && clientRow.agent_id !== user.id))
    return res.status(404).json({ error: "Client not found" });

  const recipients = clientEmails(clientRow);
  if (!recipients.length)
    return res.status(400).json({ error: "This client has no email on file — add one before sending a quotation" });

  const created = await tx(async (c) => {
    const quoteNo = await nextDocNo(c, "QT");
    const qRes = await c.query(
      `INSERT INTO quotations (quote_no, client_id, created_by, payment_terms, vat_status, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [quoteNo, client_id, user.id, payment_terms, vat_status, valid_until]
    );
    const quotation = qRes.rows[0];
    for (const it of items)
      await c.query(
        "INSERT INTO quotation_items (quotation_id, description, qty, unit_price) VALUES ($1, $2, $3, $4)",
        [quotation.id, it.description, it.qty, it.unit_price]
      );
    await audit(user.id, "quotation.created", "quotation", quotation.id, { quote_no: quoteNo, client_id }, c);
    return quotation;
  });

  const subtotal = items.reduce((s, it) => s + it.qty * it.unit_price, 0);
  const lines = items
    .map((it) => `  - ${it.description} — qty ${it.qty} x ${peso(it.unit_price)} = ${peso(it.qty * it.unit_price)}`)
    .join("\n");
  const body =
    `Hi ${clientRow.contact_name},\n\n` +
    `Please find our quotation ${created.quote_no} below.\n\n` +
    `Line items:\n${lines}\n\n` +
    `Total: ${peso(subtotal)}\n` +
    `VAT treatment: ${VAT_STATUS_LABELS[vat_status]}\n` +
    `Payment terms: ${PAYMENT_TERM_LABELS[payment_terms]}\n` +
    `Valid until: ${shortDate(valid_until)}\n\n` +
    `This is a quotation only, not an invoice or a confirmed order. Please reach out to your ` +
    `AJCB representative if you'd like to proceed.\n\n` +
    `Thank you,\n${user.full_name}\nAJCB Enterprises`;

  const html = quotationEmailHtml({
    contactName: clientRow.contact_name,
    quoteNo: created.quote_no,
    items,
    subtotal,
    vatStatus: vat_status,
    paymentTerms: payment_terms,
    validUntil: valid_until,
    agentName: user.full_name,
  });

  let sent = false;
  try {
    await sendMail(recipients, `Quotation ${created.quote_no} from AJCB Enterprises`, body, html);
    sent = true;
    await q("UPDATE quotations SET sent_at = now() WHERE id = $1", [created.id]);
    created.sent_at = new Date();
  } catch (e: any) {
    console.error(`quotation email failed for ${created.quote_no}:`, e.message);
  }

  res.status(201).json({ ...created, sent });
});
