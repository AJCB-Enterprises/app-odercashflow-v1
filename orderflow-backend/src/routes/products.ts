import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { one, q, tx } from "../db";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { audit } from "../lib/notify";
import { config } from "../config";

export const productsRouter = Router();
productsRouter.use(requireAuth);

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
});

const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  message: { error: "Too many imports, try again later" },
});

/** GET /products — the full price list, active and inactive alike; callers filter as needed. */
productsRouter.get("/", async (_req, res) => {
  const rows = await q(
    "SELECT id, description, unit_price, active, created_at FROM products ORDER BY description"
  );
  res.json(rows);
});

const ProductBody = z.object({
  description: z.string().trim().min(1),
  unit_price: z.number().min(0),
});

/** POST /products — admin adds a product to the price list. */
productsRouter.post("/", requireAdmin, async (req, res) => {
  const user = req.user!;
  const parsed = ProductBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const product = await one(
    "INSERT INTO products (description, unit_price) VALUES ($1, $2) RETURNING *",
    [parsed.data.description, parsed.data.unit_price]
  );
  await audit(user.id, "product.created", "product", (product as any).id, { description: parsed.data.description });
  res.status(201).json(product);
});

const ProductPatchBody = z.object({
  description: z.string().trim().min(1).optional(),
  unit_price: z.number().min(0).optional(),
  active: z.boolean().optional(),
});

/** PATCH /products/:id — admin edits a product's description/price, or activates/deactivates it. */
productsRouter.patch("/:id", requireAdmin, async (req, res) => {
  const user = req.user!;
  const id = String(req.params.id);
  const parsed = ProductPatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const existing = await one("SELECT * FROM products WHERE id = $1", [id]);
  if (!existing) return res.status(404).json({ error: "Product not found" });

  const description = parsed.data.description ?? (existing as any).description;
  const unitPrice = parsed.data.unit_price ?? (existing as any).unit_price;
  const active = parsed.data.active ?? (existing as any).active;

  const product = await one(
    "UPDATE products SET description = $1, unit_price = $2, active = $3 WHERE id = $4 RETURNING *",
    [description, unitPrice, active, id]
  );
  await audit(user.id, "product.updated", "product", id, parsed.data);
  res.json(product);
});

/** Splits one CSV line into fields, handling double-quoted fields (with "" as an escaped quote). */
const parseCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { fields.push(field); field = ""; }
    else field += c;
  }
  fields.push(field);
  return fields;
};

/**
 * POST /products/import — admin bulk-loads a two-column CSV (description,
 * unit_price) instead of encoding every item by hand. A row whose
 * description case-insensitively matches an existing product updates that
 * product's price (and reactivates it, since it just reappeared in the
 * list); everything else is added as new. Malformed rows are skipped and
 * reported back rather than failing the whole import.
 */
productsRouter.post("/import", requireAdmin, importLimiter, uploadCsv.single("file"), async (req, res) => {
  const user = req.user!;
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const text = req.file.buffer.toString("utf-8");
  const rawLines = text.split(/\r\n|\r|\n/);

  const lines: { num: number; raw: string }[] = [];
  rawLines.forEach((raw, idx) => {
    if (raw.trim()) lines.push({ num: idx + 1, raw });
  });

  // A header row's second column ("unit_price", "Price", …) won't parse as a number — a data row's will.
  if (lines.length && !Number.isFinite(Number((parseCsvLine(lines[0].raw)[1] || "").trim())))
    lines.shift();

  const skipped: { line: number; reason: string }[] = [];
  const rows: { description: string; unit_price: number }[] = [];
  for (const { num, raw } of lines) {
    const fields = parseCsvLine(raw);
    if (fields.length !== 2) { skipped.push({ line: num, reason: "expected 2 columns (description, unit_price)" }); continue; }
    const description = fields[0].trim();
    const unitPrice = Number(fields[1].trim());
    if (!description) { skipped.push({ line: num, reason: "missing description" }); continue; }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) { skipped.push({ line: num, reason: "invalid unit price" }); continue; }
    rows.push({ description, unit_price: unitPrice });
  }

  const { imported, updated } = await tx(async (c) => {
    const existing = await c.query("SELECT id, description FROM products");
    const byDescription = new Map<string, string>(existing.rows.map((p: any) => [p.description.toLowerCase(), p.id]));

    let imported = 0;
    let updated = 0;
    for (const row of rows) {
      const key = row.description.toLowerCase();
      const existingId = byDescription.get(key);
      if (existingId) {
        await c.query("UPDATE products SET unit_price = $1, active = true WHERE id = $2", [row.unit_price, existingId]);
        updated++;
      } else {
        const ins = await c.query(
          "INSERT INTO products (description, unit_price) VALUES ($1, $2) RETURNING id",
          [row.description, row.unit_price]
        );
        byDescription.set(key, ins.rows[0].id);
        imported++;
      }
    }
    return { imported, updated };
  });

  await audit(user.id, "product.imported", "product", "bulk-import", { imported, updated, skipped: skipped.length });
  res.json({ imported, updated, skipped });
});
