import React, { useState, useMemo } from "react";

/* ============================================================
   OrderFlow — Orders, Invoices & Payment Reminders
   Roles: Admin · Agent · Client (email + tokenized upload page)
   Single-file working prototype with in-memory data.
   ============================================================ */

const DAY = 86400000;
const NOW = new Date("2026-08-06T09:00:00");
const d = (offsetDays) => new Date(NOW.getTime() + offsetDays * DAY);
const fmtDate = (dt) =>
  new Date(dt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
const fmtTime = (dt) =>
  new Date(dt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const peso = (n) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2 });
const daysUntil = (dt) => Math.ceil((new Date(dt).getTime() - NOW.getTime()) / DAY);
let SEQ = 100;
const nid = (p) => `${p}-${++SEQ}`;
const token = () => "tok_" + Math.random().toString(36).slice(2, 10);

/* ---------------- seed data ---------------- */
const seedAgents = [
  { id: "AG-01", name: "Rosa Lim", email: "rosa@orderflow.ph", active: true, canCreatePO: true, canViewInvoices: true },
  { id: "AG-02", name: "Marco Deles", email: "marco@orderflow.ph", active: true, canCreatePO: true, canViewInvoices: true },
  { id: "AG-03", name: "Jenny Uy", email: "jenny@orderflow.ph", active: false, canCreatePO: true, canViewInvoices: false },
];

const seedClients = [
  { id: "CL-01", name: "Bayanihan Grocers", contact: "Lito Ramos", email: "lito@bayanihan.ph", phone: "0917 244 1122", agentId: "AG-01" },
  { id: "CL-02", name: "Matina Hardware", contact: "Cora Villanueva", email: "cora@matinahw.ph", phone: "0918 555 0341", agentId: "AG-01" },
  { id: "CL-03", name: "Lanang Pharma Supply", contact: "Dr. Ben Ocampo", email: "ben@lanangpharma.ph", phone: "0917 880 7754", agentId: "AG-02" },
  { id: "CL-04", name: "Agdao Fresh Mart", contact: "Mia Santos", email: "mia@agdaofresh.ph", phone: "0916 302 8890", agentId: "AG-02" },
  { id: "CL-05", name: "Toril Builders Depot", contact: "Ramon Cruz", email: "ramon@torilbuilders.ph", phone: "0919 771 2205", agentId: "AG-03" },
];

const seedOrders = [
  {
    id: "PO-2026-041", clientId: "CL-01", agentId: "AG-01", createdAt: d(-9),
    items: [{ name: "Rice 25kg sacks", qty: 40, price: 1250 }, { name: "Cooking oil 1L", qty: 120, price: 88 }],
    status: "approved", rejectReason: "",
  },
  {
    id: "PO-2026-042", clientId: "CL-03", agentId: "AG-02", createdAt: d(-6),
    items: [{ name: "Paracetamol 500mg box", qty: 60, price: 320 }, { name: "Alcohol 70% gal", qty: 24, price: 410 }],
    status: "approved", rejectReason: "",
  },
  {
    id: "PO-2026-043", clientId: "CL-02", agentId: "AG-01", createdAt: d(-2),
    items: [{ name: "Cement 40kg", qty: 100, price: 265 }, { name: "Deformed bars 10mm", qty: 200, price: 158 }],
    status: "pending", rejectReason: "",
  },
  {
    id: "PO-2026-044", clientId: "CL-04", agentId: "AG-02", createdAt: d(-1),
    items: [{ name: "Egg trays (30s)", qty: 80, price: 210 }, { name: "Sugar 1kg", qty: 150, price: 78 }],
    status: "pending", rejectReason: "",
  },
  {
    id: "PO-2026-040", clientId: "CL-05", agentId: "AG-03", createdAt: d(-12),
    items: [{ name: "Plywood 1/4 sheets", qty: 60, price: 495 }],
    status: "rejected", rejectReason: "Client credit limit reached — settle INV-2026-118 first.",
  },
];

const seedInvoices = [
  { id: "INV-2026-118", clientId: "CL-05", orderId: "PO-2026-036", amount: 84200, dueDate: d(-6), status: "unpaid", token: token(), receipt: null },
  { id: "INV-2026-121", clientId: "CL-01", orderId: "PO-2026-041", amount: 60560, dueDate: d(3), status: "unpaid", token: token(), receipt: null },
  { id: "INV-2026-122", clientId: "CL-03", orderId: "PO-2026-042", amount: 29040, dueDate: d(10), status: "unpaid", token: token(), receipt: null },
  { id: "INV-2026-115", clientId: "CL-02", orderId: "PO-2026-033", amount: 45300, dueDate: d(-20), status: "paid", token: token(), receipt: { fileName: "gcash-ref-88213.jpg", uploadedAt: d(-21) } },
  { id: "INV-2026-119", clientId: "CL-04", orderId: "PO-2026-038", amount: 18760, dueDate: d(1), status: "receipt_uploaded", token: token(), receipt: { fileName: "bdo-deposit-slip.pdf", uploadedAt: d(0) } },
];

const seedConfig = {
  payDaysBefore: 3, payFrequency: "Every 2 days", paySendTime: "08:00",
  payTemplate:
    "Hi {{contact}}, this is a friendly reminder that invoice {{invoice}} for {{amount}} is due on {{due}}. Use your secure link below to upload your payment receipt — no login needed.",
  orderFrequency: "Weekly", orderSendTime: "09:00",
  orderTemplate:
    "Hi {{contact}}, you have order {{order}} awaiting action. Reply to your agent or expect an update soon.",
};

const seedNotifs = [
  { id: nid("N"), audience: "admin", text: "New order PO-2026-044 submitted for Agdao Fresh Mart by Marco Deles.", at: d(-1), read: false },
  { id: nid("N"), audience: "admin", text: "New order PO-2026-043 submitted for Matina Hardware by Rosa Lim.", at: d(-2), read: false },
  { id: nid("N"), audience: "admin", text: "Agdao Fresh Mart uploaded a receipt for INV-2026-119.", at: d(0), read: false },
  { id: nid("N"), audience: "AG-03", text: "PO-2026-040 was rejected: client credit limit reached.", at: d(-11), read: true },
];

const seedEmails = [
  {
    id: nid("EM"), clientId: "CL-05", type: "payment", at: d(-2),
    subject: "Payment reminder — INV-2026-118 is overdue",
    body: "Hi Ramon, this is a friendly reminder that invoice INV-2026-118 for ₱84,200.00 was due on " + fmtDate(d(-6)) + ". Use your secure link below to upload your payment receipt — no login needed.",
    invoiceId: "INV-2026-118",
  },
];

/* ---------------- styles ---------------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600;700&display=swap');

:root{
  --ink:#22262F; --ink2:#4A4F5C; --muted:#7A7F8C;
  --paper:#F5F4EF; --card:#FFFFFF; --rule:#E4E1D8; --rule2:#D5D2C6;
  --green:#1E6E52; --green-bg:#E7F1EC;
  --red:#B3402F; --red-bg:#F8E9E5;
  --amber:#9A6B0B; --amber-bg:#F7EFD9;
  --blue:#31518F; --blue-bg:#E8EDF7;
  --sans:'IBM Plex Sans',system-ui,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,monospace;
  --cond:'IBM Plex Sans Condensed','IBM Plex Sans',sans-serif;
}
*{box-sizing:border-box;margin:0}
.of-root{min-height:100vh;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.5}
.of-root ::selection{background:#31518F22}

/* top bar */
.topbar{display:flex;align-items:center;gap:16px;padding:10px 20px;background:var(--ink);color:#F5F4EF;position:sticky;top:0;z-index:40}
.brand{font-family:var(--cond);font-weight:700;font-size:18px;letter-spacing:.06em;text-transform:uppercase}
.brand small{display:block;font-family:var(--mono);font-weight:400;font-size:10px;letter-spacing:.12em;color:#9BA0AD;text-transform:none}
.rolebar{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rolebar span{font-family:var(--mono);font-size:11px;color:#9BA0AD}
.rolebtn{font-family:var(--cond);font-weight:600;font-size:13px;letter-spacing:.04em;text-transform:uppercase;background:transparent;color:#C9CCD5;border:1px solid #4A4F5C;padding:5px 12px;cursor:pointer}
.rolebtn.on{background:#F5F4EF;color:var(--ink);border-color:#F5F4EF}
.rolebtn:focus-visible,.btn:focus-visible,.navbtn:focus-visible,a:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.persona{font-family:var(--mono);font-size:12px;background:#31518F;border:none;color:#fff;padding:6px 8px}

/* layout */
.shell{display:flex;min-height:calc(100vh - 52px)}
.sidenav{width:216px;flex-shrink:0;border-right:1px solid var(--rule2);padding:20px 0;background:#EFEEE7}
.navlabel{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);padding:0 18px;margin:14px 0 6px}
.navbtn{display:flex;justify-content:space-between;align-items:center;width:100%;text-align:left;font-family:var(--sans);font-size:13.5px;font-weight:500;color:var(--ink2);background:none;border:none;border-left:3px solid transparent;padding:8px 18px 8px 15px;cursor:pointer}
.navbtn:hover{background:#E7E5DC}
.navbtn.on{border-left-color:var(--ink);background:#E7E5DC;color:var(--ink);font-weight:600}
.count{font-family:var(--mono);font-size:10.5px;background:var(--red);color:#fff;border-radius:9px;padding:1px 7px}
.count.calm{background:var(--ink2)}
.main{flex:1;padding:26px 30px 60px;max-width:1080px}
h1.page{font-family:var(--cond);font-weight:700;font-size:26px;letter-spacing:.01em;text-transform:uppercase;margin-bottom:2px}
.pagesub{color:var(--muted);margin-bottom:20px}

/* cards, tables */
.card{background:var(--card);border:1px solid var(--rule2);margin-bottom:18px}
.card-h{display:flex;align-items:baseline;gap:10px;padding:12px 16px;border-bottom:1px solid var(--rule)}
.card-h h2{font-family:var(--cond);font-weight:700;font-size:15px;letter-spacing:.05em;text-transform:uppercase}
.card-h .hint{font-family:var(--mono);font-size:11px;color:var(--muted);margin-left:auto}
.card-b{padding:16px}
table.ledger{width:100%;border-collapse:collapse}
.ledger th{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);text-align:left;font-weight:500;padding:10px 16px;border-bottom:1px solid var(--rule2)}
.ledger td{padding:11px 16px;border-bottom:1px solid var(--rule);vertical-align:top}
.ledger tr:last-child td{border-bottom:none}
.ledger tr.rowbtn{cursor:pointer}
.ledger tr.rowbtn:hover td{background:#FBFAF6}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
.strong{font-weight:600}
.dim{color:var(--muted)}
.right{text-align:right}

/* chips + stamps (signature) */
.chip{display:inline-block;font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;border:1px solid currentColor}
.chip.green{color:var(--green);background:var(--green-bg)}
.chip.red{color:var(--red);background:var(--red-bg)}
.chip.amber{color:var(--amber);background:var(--amber-bg)}
.chip.blue{color:var(--blue);background:var(--blue-bg)}
.chip.gray{color:var(--ink2);background:#EFEEE7}
.stamp{display:inline-block;font-family:var(--cond);font-weight:700;font-size:20px;letter-spacing:.14em;text-transform:uppercase;padding:4px 14px;border:3px solid currentColor;transform:rotate(-4deg);opacity:.9}
.stamp.green{color:var(--green)} .stamp.red{color:var(--red)} .stamp.amber{color:var(--amber)} .stamp.blue{color:var(--blue)}

/* buttons + forms */
.btn{font-family:var(--cond);font-weight:600;font-size:13px;letter-spacing:.05em;text-transform:uppercase;padding:8px 16px;border:1px solid var(--ink);background:var(--ink);color:#F5F4EF;cursor:pointer}
.btn:hover{background:#343A47}
.btn.ghost{background:transparent;color:var(--ink)}
.btn.ghost:hover{background:#EFEEE7}
.btn.green{background:var(--green);border-color:var(--green)}
.btn.red{background:var(--red);border-color:var(--red)}
.btn.sm{font-size:11.5px;padding:5px 10px}
.btn:disabled{opacity:.45;cursor:not-allowed}
label.f{display:block;font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:12px 0 4px}
input.f,select.f,textarea.f{width:100%;font-family:var(--sans);font-size:14px;padding:8px 10px;border:1px solid var(--rule2);background:#FCFBF8;color:var(--ink)}
textarea.f{resize:vertical}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}
.statgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:18px}
.stat{background:var(--card);border:1px solid var(--rule2);padding:14px 16px}
.stat .k{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.stat .v{font-family:var(--cond);font-weight:700;font-size:26px;margin-top:2px}
.stat .v.red{color:var(--red)} .stat .v.amber{color:var(--amber)} .stat .v.green{color:var(--green)}

/* client email UI */
.mailwrap{max-width:760px;margin:0 auto}
.mail{background:var(--card);border:1px solid var(--rule2);margin-bottom:14px}
.mail-h{padding:12px 18px;border-bottom:1px solid var(--rule);display:flex;gap:10px;align-items:baseline}
.mail-h .from{font-weight:600}
.mail-b{padding:18px;white-space:pre-wrap}
.securelink{display:inline-block;margin-top:14px;font-family:var(--mono);font-size:13px;color:var(--blue);background:var(--blue-bg);border:1px dashed var(--blue);padding:9px 14px;cursor:pointer;text-decoration:none}
.uploadbox{border:2px dashed var(--rule2);background:#FCFBF8;padding:34px;text-align:center;cursor:pointer}
.uploadbox:hover{border-color:var(--blue)}
.toast{position:fixed;bottom:20px;right:20px;background:var(--ink);color:#F5F4EF;padding:12px 18px;font-family:var(--mono);font-size:12.5px;box-shadow:0 6px 24px rgba(0,0,0,.25);z-index:60;max-width:340px}
.notif{display:flex;gap:10px;padding:11px 16px;border-bottom:1px solid var(--rule)}
.notif:last-child{border-bottom:none}
.dot{width:8px;height:8px;border-radius:50%;background:var(--red);margin-top:6px;flex-shrink:0}
.dot.read{background:var(--rule2)}
.itemrow{display:grid;grid-template-columns:1fr 90px 120px 36px;gap:10px;margin-bottom:8px}
.empty{padding:28px;text-align:center;color:var(--muted);font-family:var(--mono);font-size:12.5px}
.back{background:none;border:none;color:var(--blue);font-family:var(--mono);font-size:12px;cursor:pointer;padding:0;margin-bottom:14px}
.tokline{font-family:var(--mono);font-size:11px;color:var(--muted);word-break:break-all}
@media (max-width:860px){.shell{flex-direction:column}.sidenav{width:100%;display:flex;flex-wrap:wrap;padding:8px;border-right:none;border-bottom:1px solid var(--rule2)}.navlabel{width:100%}.navbtn{width:auto;border-left:none;border-bottom:3px solid transparent}.navbtn.on{border-bottom-color:var(--ink)}.main{padding:18px 14px 60px}.grid2{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

/* ---------------- small shared bits ---------------- */
const invDerivedStatus = (inv) => {
  if (inv.status === "paid") return "paid";
  if (inv.status === "receipt_uploaded") return "receipt_uploaded";
  return daysUntil(inv.dueDate) < 0 ? "overdue" : "unpaid";
};
const invChip = (inv) => {
  const s = invDerivedStatus(inv);
  if (s === "paid") return <span className="chip green">Paid</span>;
  if (s === "receipt_uploaded") return <span className="chip blue">Receipt uploaded</span>;
  if (s === "overdue") return <span className="chip red">Overdue</span>;
  return <span className="chip amber">Unpaid</span>;
};
const orderChip = (o) =>
  o.status === "approved" ? <span className="chip green">Approved</span>
  : o.status === "rejected" ? <span className="chip red">Rejected</span>
  : <span className="chip amber">Pending review</span>;
const orderTotal = (o) => o.items.reduce((s, it) => s + it.qty * it.price, 0);

function Card({ title, hint, children, pad = true }) {
  return (
    <div className="card">
      {title && (
        <div className="card-h">
          <h2>{title}</h2>
          {hint && <span className="hint">{hint}</span>}
        </div>
      )}
      {pad ? <div className="card-b">{children}</div> : children}
    </div>
  );
}

/* ============================================================ APP */
export default function App() {
  const [agents, setAgents] = useState(seedAgents);
  const [clients, setClients] = useState(seedClients);
  const [orders, setOrders] = useState(seedOrders);
  const [invoices, setInvoices] = useState(seedInvoices);
  const [config, setConfig] = useState(seedConfig);
  const [notifs, setNotifs] = useState(seedNotifs);
  const [emails, setEmails] = useState(seedEmails);

  const [role, setRole] = useState("admin");
  const [agentId, setAgentId] = useState("AG-01");
  const [clientId, setClientId] = useState("CL-05");
  const [toast, setToast] = useState(null);

  const notify = (audience, text) =>
    setNotifs((n) => [{ id: nid("N"), audience, text, at: new Date(NOW), read: false }, ...n]);
  const pop = (msg) => {
    setToast(msg);
    window.clearTimeout(pop._t);
    pop._t = window.setTimeout(() => setToast(null), 3600);
  };

  const clientById = (id) => clients.find((c) => c.id === id) || {};
  const agentById = (id) => agents.find((a) => a.id === id) || {};

  /* ---- core actions ---- */
  const submitOrder = (agId, clId, items) => {
    const o = { id: nid("PO-2026"), clientId: clId, agentId: agId, createdAt: new Date(NOW), items, status: "pending", rejectReason: "" };
    setOrders((os) => [o, ...os]);
    notify("admin", `New order ${o.id} submitted for ${clientById(clId).name} by ${agentById(agId).name}.`);
    pop(`Order ${o.id} submitted — admin has been notified.`);
  };

  const approveOrder = (orderId) => {
    setOrders((os) => os.map((o) => (o.id === orderId ? { ...o, status: "approved" } : o)));
    const o = orders.find((x) => x.id === orderId);
    const inv = { id: nid("INV-2026"), clientId: o.clientId, orderId: o.id, amount: orderTotal(o), dueDate: d(14), status: "unpaid", token: token(), receipt: null };
    setInvoices((is) => [inv, ...is]);
    if (o.agentId) notify(o.agentId, `${o.id} was approved. Invoice ${inv.id} issued, due ${fmtDate(inv.dueDate)}.`);
    setEmails((es) => [{
      id: nid("EM"), clientId: o.clientId, type: "order", at: new Date(NOW),
      subject: `Order ${o.id} approved — invoice ${inv.id}`,
      body: `Hi ${clientById(o.clientId).contact}, your order ${o.id} has been approved. Invoice ${inv.id} for ${peso(inv.amount)} is due on ${fmtDate(inv.dueDate)}. You'll receive payment reminders with a secure upload link.`,
      invoiceId: inv.id,
    }, ...es]);
    pop(`${o.id} approved · ${inv.id} issued (${peso(inv.amount)})`);
  };

  const rejectOrder = (orderId, reason) => {
    setOrders((os) => os.map((o) => (o.id === orderId ? { ...o, status: "rejected", rejectReason: reason } : o)));
    const o = orders.find((x) => x.id === orderId);
    if (o.agentId) notify(o.agentId, `${o.id} was rejected${reason ? ": " + reason : "."}`);
    pop(`${o.id} rejected${reason ? " with reason." : "."}`);
  };

  const render = (tpl, map) => Object.entries(map).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), tpl);

  const sendPaymentReminders = () => {
    const due = invoices.filter((i) => {
      const s = invDerivedStatus(i);
      return (s === "unpaid" && daysUntil(i.dueDate) <= config.payDaysBefore) || s === "overdue";
    });
    if (!due.length) return pop("No invoices due within the reminder window.");
    const newMail = due.map((inv) => {
      const c = clientById(inv.clientId);
      const overdue = daysUntil(inv.dueDate) < 0;
      return {
        id: nid("EM"), clientId: c.id, type: "payment", at: new Date(NOW),
        subject: `Payment reminder — ${inv.id} ${overdue ? "is overdue" : "due " + fmtDate(inv.dueDate)}`,
        body: render(config.payTemplate, { contact: c.contact, invoice: inv.id, amount: peso(inv.amount), due: fmtDate(inv.dueDate) }),
        invoiceId: inv.id,
      };
    });
    setEmails((es) => [...newMail, ...es]);
    notify("admin", `Payment reminder run: ${due.length} email(s) sent with secure upload links.`);
    pop(`Sent ${due.length} payment reminder email(s) with secure links.`);
  };

  const sendOrderReminders = () => {
    const pend = orders.filter((o) => o.status === "pending");
    if (!pend.length) return pop("No pending orders to remind about.");
    const newMail = pend.map((o) => {
      const c = clientById(o.clientId);
      return {
        id: nid("EM"), clientId: c.id, type: "order", at: new Date(NOW),
        subject: `Order reminder — ${o.id} is awaiting review`,
        body: render(config.orderTemplate, { contact: c.contact, order: o.id }),
        invoiceId: null,
      };
    });
    setEmails((es) => [...newMail, ...es]);
    notify("admin", `Order reminder run: ${pend.length} email(s) sent.`);
    pop(`Sent ${pend.length} order reminder email(s).`);
  };

  const uploadReceipt = (invoiceId, fileName) => {
    setInvoices((is) => is.map((i) => (i.id === invoiceId ? { ...i, status: "receipt_uploaded", receipt: { fileName, uploadedAt: new Date(NOW) } } : i)));
    const inv = invoices.find((i) => i.id === invoiceId);
    const c = clientById(inv.clientId);
    notify("admin", `${c.name} uploaded a receipt for ${inv.id} (${fileName}).`);
    if (c.agentId) notify(c.agentId, `${c.name} uploaded a payment receipt for ${inv.id}.`);
    pop("Receipt uploaded — the team has been notified.");
  };

  const markPaid = (invoiceId) => {
    setInvoices((is) => is.map((i) => (i.id === invoiceId ? { ...i, status: "paid" } : i)));
    pop(`${invoiceId} marked as paid.`);
  };

  const app = {
    agents, setAgents, clients, setClients, orders, invoices, config, setConfig,
    notifs, setNotifs, emails, clientById, agentById,
    submitOrder, approveOrder, rejectOrder, sendPaymentReminders, sendOrderReminders,
    uploadReceipt, markPaid, notify, pop,
  };

  return (
    <div className="of-root">
      <style>{CSS}</style>
      <div className="topbar">
        <div className="brand">
          OrderFlow
          <small>orders · invoices · reminders</small>
        </div>
        <div className="rolebar">
          <span>view as</span>
          {["admin", "agent", "client"].map((r) => (
            <button key={r} className={"rolebtn" + (role === r ? " on" : "")} onClick={() => setRole(r)}>
              {r}
            </button>
          ))}
          {role === "agent" && (
            <select className="persona" value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Choose agent">
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.active ? "" : " (deactivated)"}</option>)}
            </select>
          )}
          {role === "client" && (
            <select className="persona" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Choose client">
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {role === "admin" && <AdminShell app={app} />}
      {role === "agent" && <AgentShell app={app} agentId={agentId} />}
      {role === "client" && <ClientShell app={app} clientId={clientId} />}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* ============================================================ ADMIN */
function AdminShell({ app }) {
  const [page, setPage] = useState("dashboard");
  const pendingCount = app.orders.filter((o) => o.status === "pending").length;
  const receiptCount = app.invoices.filter((i) => i.status === "receipt_uploaded").length;
  const dueCount = app.invoices.filter((i) => ["overdue"].includes(invDerivedStatus(i)) || (invDerivedStatus(i) === "unpaid" && daysUntil(i.dueDate) <= app.config.payDaysBefore)).length;
  const unreadN = app.notifs.filter((n) => n.audience === "admin" && !n.read).length;

  const nav = [
    ["dashboard", "Payment-due dashboard", dueCount],
    ["orders", "Order review", pendingCount],
    ["receipts", "Receipts to verify", receiptCount],
    ["reminders", "Reminder scheduling", 0],
    ["agents", "Agent accounts", 0],
    ["mapping", "Agent–client mapping", 0],
    ["directory", "Customer directory", 0],
    ["notifs", "Notifications", unreadN],
  ];

  return (
    <div className="shell">
      <nav className="sidenav">
        <div className="navlabel">Admin console</div>
        {nav.map(([k, label, badge]) => (
          <button key={k} className={"navbtn" + (page === k ? " on" : "")} onClick={() => setPage(k)}>
            {label}
            {badge > 0 && <span className={"count" + (k === "notifs" ? "" : k === "dashboard" ? "" : " calm")}>{badge}</span>}
          </button>
        ))}
      </nav>
      <main className="main">
        {page === "dashboard" && <AdminDashboard app={app} />}
        {page === "orders" && <AdminOrders app={app} />}
        {page === "receipts" && <AdminReceipts app={app} />}
        {page === "reminders" && <AdminReminders app={app} />}
        {page === "agents" && <AdminAgents app={app} />}
        {page === "mapping" && <AdminMapping app={app} />}
        {page === "directory" && <AdminDirectory app={app} />}
        {page === "notifs" && <NotifList app={app} audience="admin" />}
      </main>
    </div>
  );
}

function AdminDashboard({ app }) {
  const rows = app.invoices
    .filter((i) => invDerivedStatus(i) !== "paid")
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const overdue = rows.filter((i) => invDerivedStatus(i) === "overdue");
  const dueSoon = rows.filter((i) => invDerivedStatus(i) === "unpaid" && daysUntil(i.dueDate) <= app.config.payDaysBefore);
  const outstanding = rows.reduce((s, i) => s + i.amount, 0);
  return (
    <>
      <h1 className="page">Payment-due dashboard</h1>
      <p className="pagesub">Customers with payments coming due or already overdue, as of {fmtDate(NOW)}.</p>
      <div className="statgrid">
        <div className="stat"><div className="k">Overdue</div><div className="v red">{overdue.length}</div></div>
        <div className="stat"><div className="k">Due within {app.config.payDaysBefore} days</div><div className="v amber">{dueSoon.length}</div></div>
        <div className="stat"><div className="k">Outstanding total</div><div className="v">{peso(outstanding)}</div></div>
        <div className="stat"><div className="k">Receipts to verify</div><div className="v green">{app.invoices.filter((i) => i.status === "receipt_uploaded").length}</div></div>
      </div>
      <Card title="Open invoices" hint="soonest due first" pad={false}>
        <table className="ledger">
          <thead><tr><th>Invoice</th><th>Client</th><th className="right">Amount</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((i) => {
              const du = daysUntil(i.dueDate);
              return (
                <tr key={i.id}>
                  <td className="num strong">{i.id}</td>
                  <td>{app.clientById(i.clientId).name}<div className="dim">{app.clientById(i.clientId).contact}</div></td>
                  <td className="num right">{peso(i.amount)}</td>
                  <td className="num">{fmtDate(i.dueDate)}<div className={"dim"} style={du < 0 ? { color: "var(--red)" } : undefined}>{du < 0 ? `${-du} days overdue` : du === 0 ? "due today" : `in ${du} days`}</div></td>
                  <td>{invChip(i)}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="empty">Nothing outstanding. All invoices are settled.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function AdminOrders({ app }) {
  const [openId, setOpenId] = useState(null);
  const [reason, setReason] = useState("");
  const open = app.orders.find((o) => o.id === openId);

  if (open) {
    const client = app.clientById(open.clientId);
    const pendingInv = app.invoices.filter((i) => i.clientId === client.id && invDerivedStatus(i) !== "paid");
    return (
      <>
        <button className="back" onClick={() => { setOpenId(null); setReason(""); }}>← Back to order review</button>
        <h1 className="page">{open.id}</h1>
        <p className="pagesub">
          {client.name} · submitted {fmtDate(open.createdAt)} {open.agentId ? "by " + app.agentById(open.agentId).name : ""}
        </p>
        <div style={{ marginBottom: 16 }}>
          {open.status === "approved" && <span className="stamp green">Approved</span>}
          {open.status === "rejected" && <span className="stamp red">Rejected</span>}
          {open.status === "pending" && <span className="stamp amber">For review</span>}
        </div>
        <Card title="Order details" pad={false}>
          <table className="ledger">
            <thead><tr><th>Item</th><th className="right">Qty</th><th className="right">Unit price</th><th className="right">Line total</th></tr></thead>
            <tbody>
              {open.items.map((it, i) => (
                <tr key={i}><td>{it.name}</td><td className="num right">{it.qty}</td><td className="num right">{peso(it.price)}</td><td className="num right">{peso(it.qty * it.price)}</td></tr>
              ))}
              <tr><td className="strong">Total</td><td /><td /><td className="num right strong">{peso(orderTotal(open))}</td></tr>
            </tbody>
          </table>
        </Card>
        <Card title={`Pending invoices — ${client.name}`} hint="shown while reviewing" pad={false}>
          <table className="ledger">
            <thead><tr><th>Invoice</th><th className="right">Amount</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {pendingInv.map((i) => (
                <tr key={i.id}><td className="num strong">{i.id}</td><td className="num right">{peso(i.amount)}</td><td className="num">{fmtDate(i.dueDate)}</td><td>{invChip(i)}</td></tr>
              ))}
              {!pendingInv.length && <tr><td colSpan={4} className="empty">This client has no pending invoices.</td></tr>}
            </tbody>
          </table>
        </Card>
        {open.status === "pending" && (
          <Card title="Decision">
            <label className="f" htmlFor="rej">Rejection reason or comment (optional)</label>
            <textarea id="rej" className="f" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Settle outstanding invoice first, or adjust quantities." />
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button className="btn green" onClick={() => { app.approveOrder(open.id); setOpenId(null); }}>Approve order</button>
              <button className="btn red" onClick={() => { app.rejectOrder(open.id, reason.trim()); setOpenId(null); setReason(""); }}>Reject order</button>
            </div>
          </Card>
        )}
        {open.status === "rejected" && open.rejectReason && (
          <Card title="Rejection reason"><p>{open.rejectReason}</p></Card>
        )}
      </>
    );
  }

  const sorted = [...app.orders].sort((a, b) => (a.status === "pending" ? -1 : 1) - (b.status === "pending" ? -1 : 1) || new Date(b.createdAt) - new Date(a.createdAt));
  return (
    <>
      <h1 className="page">Order review</h1>
      <p className="pagesub">Review submitted orders and purchase orders. Open one to approve or reject it.</p>
      <Card pad={false}>
        <table className="ledger">
          <thead><tr><th>Order</th><th>Client</th><th>Agent</th><th className="right">Total</th><th>Submitted</th><th>Status</th></tr></thead>
          <tbody>
            {sorted.map((o) => (
              <tr key={o.id} className="rowbtn" onClick={() => setOpenId(o.id)}>
                <td className="num strong">{o.id}</td>
                <td>{app.clientById(o.clientId).name}</td>
                <td>{o.agentId ? app.agentById(o.agentId).name : <span className="dim">—</span>}</td>
                <td className="num right">{peso(orderTotal(o))}</td>
                <td className="num">{fmtDate(o.createdAt)}</td>
                <td>{orderChip(o)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function AdminReceipts({ app }) {
  const rows = app.invoices.filter((i) => i.status === "receipt_uploaded");
  return (
    <>
      <h1 className="page">Receipts to verify</h1>
      <p className="pagesub">Clients uploaded these payment receipts through their secure links. Verify against your bank records, then mark paid.</p>
      <Card pad={false}>
        <table className="ledger">
          <thead><tr><th>Invoice</th><th>Client</th><th className="right">Amount</th><th>Receipt file</th><th>Uploaded</th><th /></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td className="num strong">{i.id}</td>
                <td>{app.clientById(i.clientId).name}</td>
                <td className="num right">{peso(i.amount)}</td>
                <td className="num">{i.receipt?.fileName}</td>
                <td className="num">{fmtTime(i.receipt?.uploadedAt)}</td>
                <td className="right"><button className="btn sm green" onClick={() => app.markPaid(i.id)}>Mark paid</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="empty">No receipts waiting for verification.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function AdminReminders({ app }) {
  const c = app.config;
  const set = (k, v) => app.setConfig((cfg) => ({ ...cfg, [k]: v }));
  return (
    <>
      <h1 className="page">Reminder scheduling</h1>
      <p className="pagesub">Automated reminder emails to clients for payments and orders — frequency, timing, and message template. "Run now" simulates the scheduler.</p>
      <Card title="Payment reminders" hint="emails carry a secure, tokenized upload link">
        <div className="grid2">
          <div>
            <label className="f" htmlFor="pdb">Start reminding (days before due)</label>
            <input id="pdb" className="f num" type="number" min={0} max={30} value={c.payDaysBefore} onChange={(e) => set("payDaysBefore", +e.target.value || 0)} />
          </div>
          <div>
            <label className="f" htmlFor="pfr">Frequency</label>
            <select id="pfr" className="f" value={c.payFrequency} onChange={(e) => set("payFrequency", e.target.value)}>
              {["Daily", "Every 2 days", "Every 3 days", "Weekly"].map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label className="f" htmlFor="pst">Send time</label>
            <input id="pst" className="f num" type="time" value={c.paySendTime} onChange={(e) => set("paySendTime", e.target.value)} />
          </div>
        </div>
        <label className="f" htmlFor="ptp">Message template</label>
        <textarea id="ptp" className="f" rows={3} value={c.payTemplate} onChange={(e) => set("payTemplate", e.target.value)} />
        <p className="dim" style={{ marginTop: 6, fontSize: 12.5 }}>Placeholders: {"{{contact}} {{invoice}} {{amount}} {{due}}"}</p>
        <button className="btn" style={{ marginTop: 14 }} onClick={app.sendPaymentReminders}>Run payment reminders now</button>
      </Card>
      <Card title="Order reminders">
        <div className="grid2">
          <div>
            <label className="f" htmlFor="ofr">Frequency</label>
            <select id="ofr" className="f" value={c.orderFrequency} onChange={(e) => set("orderFrequency", e.target.value)}>
              {["Daily", "Every 3 days", "Weekly", "Every 2 weeks"].map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label className="f" htmlFor="ost">Send time</label>
            <input id="ost" className="f num" type="time" value={c.orderSendTime} onChange={(e) => set("orderSendTime", e.target.value)} />
          </div>
        </div>
        <label className="f" htmlFor="otp">Message template</label>
        <textarea id="otp" className="f" rows={2} value={c.orderTemplate} onChange={(e) => set("orderTemplate", e.target.value)} />
        <p className="dim" style={{ marginTop: 6, fontSize: 12.5 }}>Placeholders: {"{{contact}} {{order}}"}</p>
        <button className="btn" style={{ marginTop: 14 }} onClick={app.sendOrderReminders}>Run order reminders now</button>
      </Card>
    </>
  );
}

function AdminAgents({ app }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const toggle = (id, key) => app.setAgents((as) => as.map((a) => (a.id === id ? { ...a, [key]: !a[key] } : a)));
  const create = () => {
    if (!name.trim() || !email.trim()) return app.pop("Enter a name and email to create the agent account.");
    const a = { id: nid("AG"), name: name.trim(), email: email.trim(), active: true, canCreatePO: true, canViewInvoices: true };
    app.setAgents((as) => [...as, a]);
    setName(""); setEmail("");
    app.pop(`Agent account created for ${a.name}.`);
  };
  return (
    <>
      <h1 className="page">Agent accounts</h1>
      <p className="pagesub">Create agent user accounts and manage their access and permissions.</p>
      <Card title="Create agent account">
        <div className="grid2">
          <div><label className="f" htmlFor="an">Full name</label><input id="an" className="f" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Paolo Reyes" /></div>
          <div><label className="f" htmlFor="ae">Email</label><input id="ae" className="f" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@orderflow.ph" /></div>
        </div>
        <button className="btn" style={{ marginTop: 14 }} onClick={create}>Create account</button>
      </Card>
      <Card pad={false} title="All agents">
        <table className="ledger">
          <thead><tr><th>Agent</th><th>Email</th><th>Clients</th><th>Permissions</th><th>Status</th><th /></tr></thead>
          <tbody>
            {app.agents.map((a) => (
              <tr key={a.id}>
                <td className="strong">{a.name}<div className="dim num">{a.id}</div></td>
                <td className="num">{a.email}</td>
                <td className="num">{app.clients.filter((cl) => cl.agentId === a.id).length}</td>
                <td>
                  <label style={{ display: "block", cursor: "pointer" }}><input type="checkbox" checked={a.canCreatePO} onChange={() => toggle(a.id, "canCreatePO")} /> Create purchase orders</label>
                  <label style={{ display: "block", cursor: "pointer" }}><input type="checkbox" checked={a.canViewInvoices} onChange={() => toggle(a.id, "canViewInvoices")} /> View client invoices</label>
                </td>
                <td>{a.active ? <span className="chip green">Active</span> : <span className="chip gray">Deactivated</span>}</td>
                <td className="right"><button className="btn sm ghost" onClick={() => toggle(a.id, "active")}>{a.active ? "Deactivate" : "Reactivate"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function AdminMapping({ app }) {
  const reassign = (clId, agId) => {
    app.setClients((cs) => cs.map((c) => (c.id === clId ? { ...c, agentId: agId } : c)));
    app.pop("Client reassigned.");
  };
  return (
    <>
      <h1 className="page">Agent–client mapping</h1>
      <p className="pagesub">All clients grouped under each agent — drill into the orders placed for or by those clients, and reassign coverage.</p>
      {app.agents.map((a) => {
        const mine = app.clients.filter((c) => c.agentId === a.id);
        return (
          <Card key={a.id} title={a.name} hint={`${mine.length} client(s) · ${a.active ? "active" : "deactivated"}`} pad={false}>
            <table className="ledger">
              <thead><tr><th>Client</th><th>Orders</th><th>Latest order</th><th>Assigned agent</th></tr></thead>
              <tbody>
                {mine.map((c) => {
                  const os = app.orders.filter((o) => o.clientId === c.id);
                  const latest = os.sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt))[0];
                  return (
                    <tr key={c.id}>
                      <td className="strong">{c.name}</td>
                      <td className="num">{os.length}</td>
                      <td>{latest ? <><span className="num">{latest.id}</span> · {orderChip(latest)}</> : <span className="dim">No orders yet</span>}</td>
                      <td>
                        <select className="f" style={{ maxWidth: 180 }} value={c.agentId} onChange={(e) => reassign(c.id, e.target.value)} aria-label={`Reassign ${c.name}`}>
                          {app.agents.map((ag) => <option key={ag.id} value={ag.id}>{ag.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
                {!mine.length && <tr><td colSpan={4} className="empty">No clients assigned.</td></tr>}
              </tbody>
            </table>
          </Card>
        );
      })}
    </>
  );
}

function AdminDirectory({ app }) {
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null);
  const open = app.clients.find((c) => c.id === openId);

  if (open) {
    const cOrders = app.orders.filter((o) => o.clientId === open.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const cInv = app.invoices.filter((i) => i.clientId === open.id);
    const pending = cInv.filter((i) => invDerivedStatus(i) !== "paid");
    return (
      <>
        <button className="back" onClick={() => setOpenId(null)}>← Back to directory</button>
        <h1 className="page">{open.name}</h1>
        <p className="pagesub">{open.contact} · {open.email} · {open.phone} · Agent: {app.agentById(open.agentId).name || "—"}</p>
        <Card title="Pending invoices" hint="shown when reviewing this account" pad={false}>
          <table className="ledger">
            <thead><tr><th>Invoice</th><th className="right">Amount</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {pending.map((i) => (
                <tr key={i.id}><td className="num strong">{i.id}</td><td className="num right">{peso(i.amount)}</td><td className="num">{fmtDate(i.dueDate)}</td><td>{invChip(i)}</td></tr>
              ))}
              {!pending.length && <tr><td colSpan={4} className="empty">No pending invoices for this client.</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card title="Order history" pad={false}>
          <table className="ledger">
            <thead><tr><th>Order</th><th className="right">Total</th><th>Submitted</th><th>Status</th></tr></thead>
            <tbody>
              {cOrders.map((o) => (
                <tr key={o.id}><td className="num strong">{o.id}</td><td className="num right">{peso(orderTotal(o))}</td><td className="num">{fmtDate(o.createdAt)}</td><td>{orderChip(o)}</td></tr>
              ))}
              {!cOrders.length && <tr><td colSpan={4} className="empty">No orders yet.</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card title="Invoice status" pad={false}>
          <table className="ledger">
            <thead><tr><th>Invoice</th><th className="right">Amount</th><th>Due</th><th>Status</th><th>Receipt</th></tr></thead>
            <tbody>
              {cInv.map((i) => (
                <tr key={i.id}><td className="num strong">{i.id}</td><td className="num right">{peso(i.amount)}</td><td className="num">{fmtDate(i.dueDate)}</td><td>{invChip(i)}</td><td className="num">{i.receipt ? i.receipt.fileName : <span className="dim">—</span>}</td></tr>
              ))}
              {!cInv.length && <tr><td colSpan={5} className="empty">No invoices yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      </>
    );
  }

  const rows = app.clients.filter((c) =>
    (c.name + c.contact + c.email + c.phone).toLowerCase().includes(q.toLowerCase())
  );
  return (
    <>
      <h1 className="page">Customer directory</h1>
      <p className="pagesub">Central, searchable customer database — contact details, order history, and invoice status per client.</p>
      <input className="f" style={{ maxWidth: 380, marginBottom: 16 }} placeholder="Search by name, contact, email, or phone…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
      <Card pad={false}>
        <table className="ledger">
          <thead><tr><th>Client</th><th>Contact</th><th>Agent</th><th>Orders</th><th>Open invoices</th></tr></thead>
          <tbody>
            {rows.map((c) => {
              const openInv = app.invoices.filter((i) => i.clientId === c.id && invDerivedStatus(i) !== "paid");
              return (
                <tr key={c.id} className="rowbtn" onClick={() => setOpenId(c.id)}>
                  <td className="strong">{c.name}<div className="dim num">{c.id}</div></td>
                  <td>{c.contact}<div className="dim num">{c.email} · {c.phone}</div></td>
                  <td>{app.agentById(c.agentId).name || "—"}</td>
                  <td className="num">{app.orders.filter((o) => o.clientId === c.id).length}</td>
                  <td>{openInv.length ? <span className="chip amber">{openInv.length} open · {peso(openInv.reduce((s, i) => s + i.amount, 0))}</span> : <span className="chip green">Clear</span>}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="empty">No customers match "{q}".</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}

/* ============================================================ AGENT */
function AgentShell({ app, agentId }) {
  const agent = app.agentById(agentId);
  const [page, setPage] = useState("clients");
  const myClients = app.clients.filter((c) => c.agentId === agentId);
  const myClientIds = myClients.map((c) => c.id);
  const alerts = useMemo(() => {
    const list = [];
    myClients.forEach((c) => {
      const pendingOrders = app.orders.filter((o) => o.clientId === c.id && o.status === "pending");
      const unpaid = app.invoices.filter((i) => i.clientId === c.id && ["unpaid", "overdue"].includes(invDerivedStatus(i)));
      if (pendingOrders.length) list.push({ client: c, text: `${pendingOrders.length} order(s) pending review (${pendingOrders.map((o) => o.id).join(", ")})`, tone: "amber" });
      unpaid.forEach((i) => {
        const du = daysUntil(i.dueDate);
        list.push({ client: c, text: `${i.id} ${du < 0 ? `${-du} days overdue` : `due in ${du} day(s)`} — ${peso(i.amount)}`, tone: du < 0 ? "red" : "amber" });
      });
    });
    return list;
  }, [app.orders, app.invoices, myClients]);
  const unreadN = app.notifs.filter((n) => n.audience === agentId && !n.read).length;

  if (!agent.active) {
    return (
      <div className="shell"><main className="main">
        <h1 className="page">Account deactivated</h1>
        <p className="pagesub">This agent account has been deactivated by the admin. Contact the admin to restore access.</p>
      </main></div>
    );
  }

  const nav = [
    ["clients", "My assigned clients", 0],
    ["po", "New purchase order", 0],
    ["orders", "Orders by client", 0],
    ["invoices", "Client past invoices", 0],
    ["alerts", "Pending client alerts", alerts.length],
    ["notifs", "Notifications", unreadN],
  ];

  return (
    <div className="shell">
      <nav className="sidenav">
        <div className="navlabel">Agent · {agent.name}</div>
        {nav.map(([k, label, badge]) => (
          <button key={k} className={"navbtn" + (page === k ? " on" : "")} onClick={() => setPage(k)}>
            {label}{badge > 0 && <span className="count">{badge}</span>}
          </button>
        ))}
      </nav>
      <main className="main">
        {page === "clients" && (
          <>
            <h1 className="page">My assigned clients</h1>
            <p className="pagesub">Clients assigned to you by the admin.</p>
            <Card pad={false}>
              <table className="ledger">
                <thead><tr><th>Client</th><th>Contact</th><th>Orders</th><th>Open invoices</th></tr></thead>
                <tbody>
                  {myClients.map((c) => {
                    const openInv = app.invoices.filter((i) => i.clientId === c.id && invDerivedStatus(i) !== "paid");
                    return (
                      <tr key={c.id}>
                        <td className="strong">{c.name}</td>
                        <td>{c.contact}<div className="dim num">{c.email} · {c.phone}</div></td>
                        <td className="num">{app.orders.filter((o) => o.clientId === c.id).length}</td>
                        <td>{openInv.length ? <span className="chip amber">{openInv.length} open</span> : <span className="chip green">Clear</span>}</td>
                      </tr>
                    );
                  })}
                  {!myClients.length && <tr><td colSpan={4} className="empty">No clients assigned to you yet.</td></tr>}
                </tbody>
              </table>
            </Card>
          </>
        )}
        {page === "po" && <AgentPO app={app} agent={agent} myClients={myClients} onDone={() => setPage("orders")} />}
        {page === "orders" && <AgentOrders app={app} myClients={myClients} />}
        {page === "invoices" && <AgentInvoices app={app} agent={agent} myClients={myClients} />}
        {page === "alerts" && (
          <>
            <h1 className="page">Pending client alerts</h1>
            <p className="pagesub">Assigned clients with pending orders or unpaid invoices.</p>
            <Card pad={false}>
              {alerts.map((a, i) => (
                <div className="notif" key={i}>
                  <span className={"chip " + a.tone} style={{ alignSelf: "flex-start" }}>{a.tone === "red" ? "Overdue" : "Pending"}</span>
                  <div><span className="strong">{a.client.name}</span> — {a.text}</div>
                </div>
              ))}
              {!alerts.length && <div className="empty">All clear — no pending orders or unpaid invoices among your clients.</div>}
            </Card>
          </>
        )}
        {page === "notifs" && <NotifList app={app} audience={agentId} />}
      </main>
    </div>
  );
}

function AgentPO({ app, agent, myClients, onDone }) {
  const [clId, setClId] = useState(myClients[0]?.id || "");
  const [items, setItems] = useState([{ name: "", qty: 1, price: 0 }]);
  const setItem = (i, k, v) => setItems((its) => its.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const total = items.reduce((s, it) => s + (+it.qty || 0) * (+it.price || 0), 0);
  const valid = clId && items.some((it) => it.name.trim() && +it.qty > 0 && +it.price > 0);

  if (!agent.canCreatePO)
    return (<><h1 className="page">New purchase order</h1><p className="pagesub">Your account doesn't have the "create purchase orders" permission. Ask the admin to enable it.</p></>);

  return (
    <>
      <h1 className="page">New purchase order</h1>
      <p className="pagesub">Create and submit a purchase order on behalf of an assigned client. It goes to the admin for review.</p>
      <Card>
        <label className="f" htmlFor="poc">On behalf of client</label>
        <select id="poc" className="f" style={{ maxWidth: 340 }} value={clId} onChange={(e) => setClId(e.target.value)}>
          {myClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="f">Line items</label>
        {items.map((it, i) => (
          <div className="itemrow" key={i}>
            <input className="f" placeholder="Item description" value={it.name} onChange={(e) => setItem(i, "name", e.target.value)} aria-label={`Item ${i + 1} description`} />
            <input className="f num" type="number" min={1} placeholder="Qty" value={it.qty} onChange={(e) => setItem(i, "qty", e.target.value)} aria-label={`Item ${i + 1} quantity`} />
            <input className="f num" type="number" min={0} step="0.01" placeholder="Unit ₱" value={it.price} onChange={(e) => setItem(i, "price", e.target.value)} aria-label={`Item ${i + 1} unit price`} />
            <button className="btn sm ghost" onClick={() => setItems((its) => its.filter((_, j) => j !== i))} disabled={items.length === 1} aria-label={`Remove item ${i + 1}`}>×</button>
          </div>
        ))}
        <button className="btn sm ghost" onClick={() => setItems((its) => [...its, { name: "", qty: 1, price: 0 }])}>+ Add line</button>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 18 }}>
          <span className="num strong" style={{ fontSize: 16 }}>Total {peso(total)}</span>
          <button className="btn" disabled={!valid} onClick={() => {
            const clean = items.filter((it) => it.name.trim() && +it.qty > 0 && +it.price > 0).map((it) => ({ name: it.name.trim(), qty: +it.qty, price: +it.price }));
            app.submitOrder(agent.id, clId, clean);
            setItems([{ name: "", qty: 1, price: 0 }]);
            onDone();
          }}>Submit for review</button>
        </div>
      </Card>
    </>
  );
}

function AgentOrders({ app, myClients }) {
  return (
    <>
      <h1 className="page">Orders by client</h1>
      <p className="pagesub">All orders under each of your assigned clients.</p>
      {myClients.map((c) => {
        const os = app.orders.filter((o) => o.clientId === c.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return (
          <Card key={c.id} title={c.name} pad={false}>
            <table className="ledger">
              <thead><tr><th>Order</th><th className="right">Total</th><th>Submitted</th><th>Status</th><th>Note</th></tr></thead>
              <tbody>
                {os.map((o) => (
                  <tr key={o.id}>
                    <td className="num strong">{o.id}</td>
                    <td className="num right">{peso(orderTotal(o))}</td>
                    <td className="num">{fmtDate(o.createdAt)}</td>
                    <td>{orderChip(o)}</td>
                    <td className="dim">{o.rejectReason || "—"}</td>
                  </tr>
                ))}
                {!os.length && <tr><td colSpan={5} className="empty">No orders yet for this client.</td></tr>}
              </tbody>
            </table>
          </Card>
        );
      })}
    </>
  );
}

function AgentInvoices({ app, agent, myClients }) {
  if (!agent.canViewInvoices)
    return (<><h1 className="page">Client past invoices</h1><p className="pagesub">Your account doesn't have the "view client invoices" permission. Ask the admin to enable it.</p></>);
  return (
    <>
      <h1 className="page">Client past invoices</h1>
      <p className="pagesub">Previous and current invoices for each of your assigned clients.</p>
      {myClients.map((c) => {
        const inv = app.invoices.filter((i) => i.clientId === c.id).sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate));
        return (
          <Card key={c.id} title={c.name} pad={false}>
            <table className="ledger">
              <thead><tr><th>Invoice</th><th className="right">Amount</th><th>Due</th><th>Status</th></tr></thead>
              <tbody>
                {inv.map((i) => (
                  <tr key={i.id}><td className="num strong">{i.id}</td><td className="num right">{peso(i.amount)}</td><td className="num">{fmtDate(i.dueDate)}</td><td>{invChip(i)}</td></tr>
                ))}
                {!inv.length && <tr><td colSpan={4} className="empty">No invoices yet for this client.</td></tr>}
              </tbody>
            </table>
          </Card>
        );
      })}
    </>
  );
}

/* ============================================================ CLIENT */
function ClientShell({ app, clientId }) {
  const client = app.clientById(clientId);
  const [openToken, setOpenToken] = useState(null);
  const inbox = app.emails.filter((e) => e.clientId === clientId).sort((a, b) => new Date(b.at) - new Date(a.at));
  const inv = openToken ? app.invoices.find((i) => i.token === openToken) : null;

  if (inv) return <UploadPage app={app} inv={inv} onBack={() => setOpenToken(null)} />;

  return (
    <div className="shell">
      <main className="main" style={{ maxWidth: "100%" }}>
        <div className="mailwrap">
          <h1 className="page">Inbox — {client.contact}</h1>
          <p className="pagesub">{client.name} · Simulated email client. Reminders arrive here per the admin-configured schedule; payment reminders carry a secure, tokenized link — no login needed.</p>
          {inbox.map((m) => {
            const mi = m.invoiceId ? app.invoices.find((i) => i.id === m.invoiceId) : null;
            return (
              <div className="mail" key={m.id}>
                <div className="mail-h">
                  <span className="from">OrderFlow Billing</span>
                  <span className="dim">{m.subject}</span>
                  <span className="dim num" style={{ marginLeft: "auto" }}>{fmtTime(m.at)}</span>
                </div>
                <div className="mail-b">
                  {m.body}
                  {m.type === "payment" && mi && (
                    <div>
                      {mi.status === "unpaid" ? (
                        <>
                          <button className="securelink" onClick={() => setOpenToken(mi.token)}>
                            → Upload payment receipt (secure link)
                          </button>
                          <div className="tokline" style={{ marginTop: 8 }}>pay.orderflow.ph/upload?token={mi.token}</div>
                        </>
                      ) : (
                        <div style={{ marginTop: 14 }}>{invChip(mi)} <span className="dim"> — thank you, no further action needed.</span></div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!inbox.length && <div className="card"><div className="empty">No emails yet. Ask the admin to run a reminder, or wait for an order update.</div></div>}
        </div>
      </main>
    </div>
  );
}

function UploadPage({ app, inv, onBack }) {
  const [fileName, setFileName] = useState("");
  const [done, setDone] = useState(false);
  const client = app.clientById(inv.clientId);
  const overdueBy = -daysUntil(inv.dueDate);

  const pickFile = () => {
    const samples = ["gcash-receipt-" + Math.floor(Math.random() * 90000 + 10000) + ".jpg", "bank-deposit-slip.pdf", "instapay-confirmation.png"];
    setFileName(samples[Math.floor(Math.random() * samples.length)]);
  };

  return (
    <div className="shell">
      <main className="main" style={{ maxWidth: "100%" }}>
        <div className="mailwrap">
          <button className="back" onClick={onBack}>← Back to inbox</button>
          <Card title="Payment receipt upload" hint="secure link · no login required">
            <p className="tokline">pay.orderflow.ph/upload?token={inv.token}</p>
            <table className="ledger" style={{ margin: "14px 0" }}>
              <tbody>
                <tr><td className="dim">Billed to</td><td className="strong">{client.name}</td></tr>
                <tr><td className="dim">Invoice</td><td className="num strong">{inv.id}</td></tr>
                <tr><td className="dim">Amount due</td><td className="num strong">{peso(inv.amount)}</td></tr>
                <tr><td className="dim">Due date</td><td className="num">{fmtDate(inv.dueDate)} {overdueBy > 0 && <span className="chip red" style={{ marginLeft: 8 }}>{overdueBy} days overdue</span>}</td></tr>
              </tbody>
            </table>
            <p className="dim" style={{ marginBottom: 14 }}>
              This page only records your proof of payment — it does not process the payment itself. Pay via your usual channel (bank transfer, GCash, cheque), then upload the receipt image or PDF here.
            </p>
            {done ? (
              <div style={{ textAlign: "center", padding: "18px 0" }}>
                <span className="stamp blue">Receipt received</span>
                <p style={{ marginTop: 16 }}>We've notified the billing team. They'll verify <span className="num">{fileName}</span> and mark {inv.id} as paid.</p>
              </div>
            ) : (
              <>
                <div className="uploadbox" role="button" tabIndex={0} onClick={pickFile} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pickFile()}>
                  {fileName ? (
                    <span className="num strong">{fileName} ✓ ready to submit</span>
                  ) : (
                    <>
                      <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16, textTransform: "uppercase", letterSpacing: ".05em" }}>Drop receipt here or click to choose</div>
                      <div className="dim" style={{ marginTop: 4 }}>JPG, PNG, or PDF · max 10 MB (simulated)</div>
                    </>
                  )}
                </div>
                <button className="btn" style={{ marginTop: 14 }} disabled={!fileName} onClick={() => { app.uploadReceipt(inv.id, fileName); setDone(true); }}>
                  Submit receipt
                </button>
              </>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}

/* ============================================================ shared notifications */
function NotifList({ app, audience }) {
  const rows = app.notifs.filter((n) => n.audience === audience);
  const markAll = () => app.setNotifs((ns) => ns.map((n) => (n.audience === audience ? { ...n, read: true } : n)));
  return (
    <>
      <h1 className="page">Notifications</h1>
      <p className="pagesub">In-app alerts{audience === "admin" ? " — new orders, uploaded receipts, and reminder runs" : " for your account"}.</p>
      {rows.some((n) => !n.read) && <button className="btn sm ghost" style={{ marginBottom: 12 }} onClick={markAll}>Mark all read</button>}
      <Card pad={false}>
        {rows.map((n) => (
          <div className="notif" key={n.id}>
            <span className={"dot" + (n.read ? " read" : "")} />
            <div>{n.text}<div className="dim num" style={{ fontSize: 11.5 }}>{fmtTime(n.at)}</div></div>
          </div>
        ))}
        {!rows.length && <div className="empty">No notifications yet.</div>}
      </Card>
    </>
  );
}
