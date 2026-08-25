import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtDate, peso } from "../../api";
import { Card, ErrorBox, InvoiceChip, Loading, NewClientForm, OrderChip, PAYMENT_TERM_OPTIONS, useData, useToast, VAT_STATUS_OPTIONS } from "../../components";

/* ---- My assigned clients ---- */
export function AgentClients() {
  const { data, error, loading, reload } = useData<any[]>(() => api.get("/clients"), []);
  const [showForm, setShowForm] = useState(false);
  return (
    <>
      <h1 className="page">My assigned clients</h1>
      <p className="pagesub">Clients assigned to you by the admin. New clients you add here are assigned to you automatically.</p>
      <button className="btn sm" style={{ marginBottom: 16 }} onClick={() => setShowForm((s) => !s)}>
        {showForm ? "Cancel" : "+ New client"}
      </button>
      {showForm && <NewClientForm onDone={() => { setShowForm(false); reload(); }} />}
      {error && <ErrorBox msg={error} />}
      <Card pad={false}>
        {loading ? <Loading /> : (
          <table className="ledger">
            <thead><tr><th>Client</th><th>Contact</th><th>Address</th><th>Orders</th><th>Open invoices</th></tr></thead>
            <tbody>
              {(data || []).map((c) => (
                <tr key={c.id}>
                  <td className="strong">{c.company_name}</td>
                  <td>{c.contact_name}<div className="dim num">{c.email} · {c.phone || "no phone"}</div></td>
                  <td className="dim">{c.address || "—"}</td>
                  <td className="num">{c.order_count}</td>
                  <td>
                    {Number(c.open_invoice_count) > 0
                      ? <span className="chip amber">{c.open_invoice_count} open</span>
                      : <span className="chip green">Clear</span>}
                  </td>
                </tr>
              ))}
              {!data?.length && <tr><td colSpan={5} className="empty">No clients assigned to you yet.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

/* ---- New purchase order ---- */
export function AgentNewOrder() {
  const { data: clients, error, loading } = useData<any[]>(() => api.get("/clients"), []);
  const [clientId, setClientId] = useState("");
  const [items, setItems] = useState([{ description: "", qty: "1", unit_price: "" }]);
  const [paymentTerms, setPaymentTerms] = useState("net_30");
  const [vatStatus, setVatStatus] = useState("vat_inclusive");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const setItem = (i: number, k: string, v: string) =>
    setItems((its) => its.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const clean = items
    .filter((it) => it.description.trim() && Number(it.qty) > 0 && Number(it.unit_price) > 0)
    .map((it) => ({ description: it.description.trim(), qty: Number(it.qty), unit_price: Number(it.unit_price) }));
  const total = clean.reduce((s, it) => s + it.qty * it.unit_price, 0);
  const chosen = clientId || clients?.[0]?.id || "";

  const submit = async () => {
    setBusy(true);
    try {
      const order = await api.post("/orders", {
        client_id: chosen, items: clean, payment_terms: paymentTerms, vat_status: vatStatus,
      });
      toast(`Order ${order.order_no} submitted — admin has been notified.`);
      navigate("/agent/orders");
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="page">New purchase order</h1>
      <p className="pagesub">Create and submit a purchase order on behalf of an assigned client. It goes to the admin for review.</p>
      {error && <ErrorBox msg={error} />}
      {loading ? <Loading /> : (
        <Card>
          <label className="f" htmlFor="poc">On behalf of client</label>
          <select id="poc" className="f" style={{ maxWidth: 340 }} value={chosen} onChange={(e) => setClientId(e.target.value)}>
            {(clients || []).map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          <label className="f" htmlFor="pot">Payment terms</label>
          <select id="pot" className="f" style={{ maxWidth: 340 }} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}>
            {PAYMENT_TERM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <label className="f" htmlFor="pov">VAT status</label>
          <select id="pov" className="f" style={{ maxWidth: 340 }} value={vatStatus} onChange={(e) => setVatStatus(e.target.value)}>
            {VAT_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <label className="f">Line items</label>
          {items.map((it, i) => (
            <div className="itemrow" key={i}>
              <input className="f" placeholder="Item description" value={it.description}
                onChange={(e) => setItem(i, "description", e.target.value)} aria-label={`Item ${i + 1} description`} />
              <input className="f num" type="number" min={1} placeholder="Qty" value={it.qty}
                onChange={(e) => setItem(i, "qty", e.target.value)} aria-label={`Item ${i + 1} quantity`} />
              <input className="f num" type="number" min={0} step="0.01" placeholder="Unit ₱" value={it.unit_price}
                onChange={(e) => setItem(i, "unit_price", e.target.value)} aria-label={`Item ${i + 1} unit price`} />
              <button className="btn sm ghost" disabled={items.length === 1} aria-label={`Remove item ${i + 1}`}
                onClick={() => setItems((its) => its.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button className="btn sm ghost" onClick={() => setItems((its) => [...its, { description: "", qty: "1", unit_price: "" }])}>
            + Add line
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 18 }}>
            <span className="num strong" style={{ fontSize: 16 }}>Total {peso(total)}</span>
            <button className="btn" disabled={!chosen || !clean.length || busy} onClick={submit}>
              {busy ? "Submitting…" : "Submit for review"}
            </button>
          </div>
        </Card>
      )}
    </>
  );
}

/* ---- Orders by client ---- */
export function AgentOrders() {
  const { data, error, loading } = useData<any[]>(() => api.get("/orders"), []);
  const byClient = useMemo(() => {
    const map = new Map<string, any[]>();
    (data || []).forEach((o) => {
      const list = map.get(o.company_name) || [];
      list.push(o);
      map.set(o.company_name, list);
    });
    return [...map.entries()];
  }, [data]);

  return (
    <>
      <h1 className="page">Orders by client</h1>
      <p className="pagesub">All orders under each of your assigned clients.</p>
      {error && <ErrorBox msg={error} />}
      {loading ? <Loading /> : byClient.length ? byClient.map(([name, orders]) => (
        <Card key={name} title={name} pad={false}>
          <table className="ledger">
            <thead><tr><th>Order</th><th className="right">Total</th><th>Submitted</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="num strong">{o.order_no}</td>
                  <td className="num right">{peso(o.total)}</td>
                  <td className="num">{fmtDate(o.created_at)}</td>
                  <td><OrderChip status={o.status} /></td>
                  <td className="dim">{o.reject_reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )) : <Card><div className="empty">No orders yet — create one from "New purchase order".</div></Card>}
    </>
  );
}

/* ---- Client past invoices ---- */
export function AgentInvoices() {
  const { data, error, loading } = useData<any[]>(() => api.get("/invoices"), []);
  const byClient = useMemo(() => {
    const map = new Map<string, any[]>();
    (data || []).forEach((i) => {
      const list = map.get(i.company_name) || [];
      list.push(i);
      map.set(i.company_name, list);
    });
    return [...map.entries()];
  }, [data]);

  return (
    <>
      <h1 className="page">Client past invoices</h1>
      <p className="pagesub">Previous and current invoices for each of your assigned clients.</p>
      {error && (
        <ErrorBox msg={error.includes("permission")
          ? "Your account doesn't have the \"view client invoices\" permission. Ask the admin to enable it."
          : error} />
      )}
      {loading ? <Loading /> : byClient.map(([name, invoices]) => (
        <Card key={name} title={name} pad={false}>
          <table className="ledger">
            <thead><tr><th>Invoice</th><th className="right">Amount</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="num strong">{i.invoice_no}</td>
                  <td className="num right">{peso(i.amount)}</td>
                  <td className="num">{fmtDate(i.due_date)}</td>
                  <td><InvoiceChip inv={i} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
      {!loading && !error && !byClient.length && <Card><div className="empty">No invoices yet for your clients.</div></Card>}
    </>
  );
}
