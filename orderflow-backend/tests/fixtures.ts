import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../src/db";
import { config } from "../src/config";

let seq = 0;
const uniq = (label: string) => `${label}-${Date.now()}-${seq++}`;

export const createUser = async (opts: {
  role: "admin" | "agent";
  email?: string;
  fullName?: string;
  password?: string;
  canCreatePo?: boolean;
  canViewInvoices?: boolean;
  canManageAgents?: boolean;
  canManageAnnouncements?: boolean;
}) => {
  const hash = bcrypt.hashSync(opts.password ?? "test-password-123", 4); // low rounds — speed, not security, in tests
  const { rows } = await pool.query(
    `INSERT INTO users (role, full_name, email, password_hash, can_create_po, can_view_invoices, can_manage_agents, can_manage_announcements)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      opts.role,
      opts.fullName ?? "Test User",
      opts.email ?? `${uniq("user")}@example.com`,
      hash,
      opts.canCreatePo ?? true,
      opts.canViewInvoices ?? true,
      opts.canManageAgents ?? true,
      opts.canManageAnnouncements ?? true,
    ]
  );
  return rows[0];
};

export const tokenFor = (user: { id: string; role: string }) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpires } as jwt.SignOptions);

export const createClientRow = async (opts: {
  companyName?: string;
  contactName?: string;
  email?: string;
  agentId?: string | null;
  tin?: string | null;
} = {}) => {
  const { rows } = await pool.query(
    `INSERT INTO clients (company_name, contact_name, email, agent_id, tin) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      opts.companyName ?? "Test Co",
      opts.contactName ?? "Test Contact",
      opts.email ?? `${uniq("client")}@example.com`,
      opts.agentId ?? null,
      opts.tin ?? null,
    ]
  );
  return rows[0];
};

export const createOrder = async (opts: { clientId: string; orderNo?: string; status?: "pending" | "approved" | "rejected" | "cancelled" }) => {
  const { rows } = await pool.query(
    `INSERT INTO orders (order_no, client_id, status) VALUES ($1, $2, $3) RETURNING *`,
    [opts.orderNo ?? uniq("SO"), opts.clientId, opts.status ?? "pending"]
  );
  return rows[0];
};

export const createInvoice = async (opts: {
  clientId: string;
  amount: number;
  invoiceNo?: string;
  dueDate?: string;
  status?: "unpaid" | "receipt_uploaded" | "paid" | "void";
  orderId?: string | null;
}) => {
  const { rows } = await pool.query(
    `INSERT INTO invoices (client_id, invoice_no, amount, due_date, status, order_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      opts.clientId,
      opts.invoiceNo ?? uniq("SI"),
      opts.amount,
      opts.dueDate ?? new Date().toISOString().slice(0, 10),
      opts.status ?? "unpaid",
      opts.orderId ?? null,
    ]
  );
  return rows[0];
};
