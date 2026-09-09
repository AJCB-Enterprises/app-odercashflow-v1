import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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

/* ---- New sales order ---- */
export function AgentNewOrder() {
  const { data: clients, error, loading } = useData<any[]>(() => api.get("/clients"), []);
  const [clientId, setClientId] = useState("");
  const [items, setItems] = useState([{ description: "", qty: "1", unit_price: "" }]);
  const [paymentTerms, setPaymentTerms] = useState("net_30");
  const [poDate, setPoDate] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOrderInfo, setLastOrderInfo] = useState<{ order_no: string; created_at: string } | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  const setItem = (i: number, k: string, v: string) =>
    setItems((its) => its.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const clean = items
    .filter((it) => it.description.trim() && Number(it.qty) > 0 && Number(it.unit_price) > 0)
    .map((it) => ({ description: it.description.trim(), qty: Number(it.qty), unit_price: Number(it.unit_price) }));
  const total = clean.reduce((s, it) => s + it.qty * it.unit_price, 0);
  const chosen = clientId || clients?.[0]?.id || "";
  const chosenClient = (clients || []).find((c) => c.id === chosen);

  // Payment terms default to whatever's normal for this client, but this
  // order can deviate (e.g. usually Net 30, this one's COD) -- VAT status
  // can't; that's fixed on the client's own record.
  useEffect(() => {
    if (chosenClient) setPaymentTerms(chosenClient.payment_terms);
  }, [chosenClient?.id]);

  // Repeat customers tend to order roughly the same things — pre-fill the
  // line items from their most recent order so the agent isn't re-typing
  // every item every time; they can still edit/add/remove before submitting.
  useEffect(() => {
    if (!chosenClient) return;
    let cancelled = false;
    api.get<{ order_no: string; created_at: string; items: { description: string; qty: number; unit_price: number }[] } | null>(
      `/clients/${chosenClient.id}/last-order`
    ).then((last) => {
      if (cancelled) return;
      if (last && last.items.length) {
        setItems(last.items.map((it) => ({ description: it.description, qty: String(it.qty), unit_price: String(it.unit_price) })));
        setLastOrderInfo({ order_no: last.order_no, created_at: last.created_at });
      } else {
        setItems([{ description: "", qty: "1", unit_price: "" }]);
        setLastOrderInfo(null);
      }
    }).catch(() => setLastOrderInfo(null));
    return () => { cancelled = true; };
  }, [chosenClient?.id]);

  const submit = async () => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("client_id", chosen);
      form.append("items", JSON.stringify(clean));
      form.append("payment_terms", paymentTerms);
      if (poDate) form.append("po_date", poDate);
      if (poNumber.trim()) form.append("po_number", poNumber.trim());
      if (file) form.append("file", file);
      const order = await api.postForm("/orders", form);
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
      <h1 className="page">New sales order</h1>
      <p className="pagesub">Create and submit a sales order on behalf of an assigned client. It goes to the admin for review.</p>
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
          {chosenClient && (
            <p className="dim" style={{ marginTop: -6, marginBottom: 14, fontSize: 12.5 }}>
              VAT status: {VAT_STATUS_OPTIONS.find((o) => o.value === chosenClient.vat_status)?.label || chosenClient.vat_status}
              {" — set on the client's record; edit there to change it."}
            </p>
          )}
          {chosenClient && (
            <p className="dim" style={{ marginTop: -6, marginBottom: 14, fontSize: 12.5 }}>
              Billing: {chosenClient.consolidated_invoicing
                ? "Consolidated — this client is invoiced once per PO, not per order."
                : "Per order — invoiced when this order is approved."}
              {" — set on the client's record; edit there to change it."}
            </p>
          )}
          <label className="f" htmlFor="pod">Purchase order date</label>
          <input id="pod" className="f" type="date" style={{ maxWidth: 340 }} value={poDate} onChange={(e) => setPoDate(e.target.value)} />
          <label className="f" htmlFor="pon">Purchase order number</label>
          <input id="pon" className="f" style={{ maxWidth: 340 }} placeholder="Client's own PO reference, e.g. PO-1042"
            value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
          <label className="f" htmlFor="pof">Attach PO document (optional)</label>
          <input id="pof" className="f" type="file" accept=".jpg,.jpeg,.png,.pdf" style={{ maxWidth: 340 }}
            onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <label className="f">Line items</label>
          {lastOrderInfo && (
            <p className="dim" style={{ marginTop: -6, marginBottom: 10, fontSize: 12.5 }}>
              Pre-filled from {lastOrderInfo.order_no} ({fmtDate(lastOrderInfo.created_at)}) — review before submitting.
            </p>
          )}
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
  const navigate = useNavigate();
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
                <tr key={o.id} className="rowbtn" onClick={() => navigate(`/agent/orders/${o.id}`)}>
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
      )) : <Card><div className="empty">No orders yet — create one from "New sales order".</div></Card>}
    </>
  );
}

/* ---- Order detail — revisable while still pending ---- */
export function AgentOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useData<any>(() => api.get(`/orders/${id}`), [id]);

  const [seeded, setSeeded] = useState(false);
  const [items, setItems] = useState([{ description: "", qty: "1", unit_price: "" }]);
  const [poDate, setPoDate] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data || seeded) return;
    setItems(
      data.items.length
        ? data.items.map((it: any) => ({ description: it.description, qty: String(it.qty), unit_price: String(it.unit_price) }))
        : [{ description: "", qty: "1", unit_price: "" }]
    );
    setPoDate(data.order.po_date ? String(data.order.po_date).slice(0, 10) : "");
    setPoNumber(data.order.po_number || "");
    setSeeded(true);
  }, [data, seeded]);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox msg={error || "Order not found"} />;
  const { order } = data;

  const setItem = (i: number, k: string, v: string) =>
    setItems((its) => its.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const clean = items
    .filter((it) => it.description.trim() && Number(it.qty) > 0 && Number(it.unit_price) > 0)
    .map((it) => ({ description: it.description.trim(), qty: Number(it.qty), unit_price: Number(it.unit_price) }));
  const total = clean.reduce((s, it) => s + it.qty * it.unit_price, 0);

  const viewAttachment = async () => {
    try {
      await api.openBlob(`/orders/${id}/attachment`);
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("items", JSON.stringify(clean));
      if (poDate) form.append("po_date", poDate);
      if (poNumber.trim()) form.append("po_number", poNumber.trim());
      if (file) form.append("file", file);
      await api.patchForm(`/orders/${id}`, form);
      toast(`${order.order_no} updated — admin has been notified to take another look.`);
      reload();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="back" onClick={() => navigate("/agent/orders")}>← Back to orders</button>
      <h1 className="page">{order.order_no}</h1>
      <p className="pagesub">{order.company_name} · submitted {fmtDate(order.created_at)}</p>
      <div style={{ marginBottom: 16 }}><OrderChip status={order.status} /></div>

      {order.status !== "pending" ? (
        <Card title="Order details" pad={false}>
          <table className="ledger">
            <thead><tr><th>Item</th><th className="right">Qty</th><th className="right">Unit price</th><th className="right">Line total</th></tr></thead>
            <tbody>
              {data.items.map((it: any) => (
                <tr key={it.id}>
                  <td>{it.description}</td>
                  <td className="num right">{Number(it.qty)}</td>
                  <td className="num right">{peso(it.unit_price)}</td>
                  <td className="num right">{peso(Number(it.qty) * Number(it.unit_price))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {order.status === "rejected" && order.reject_reason && (
            <p className="dim" style={{ marginTop: 12, marginBottom: 0 }}>Rejected: {order.reject_reason}</p>
          )}
        </Card>
      ) : (
        <Card title="Revise order" hint="still pending review — saving notifies the admin to take another look">
          <label className="f" htmlFor="epod">Purchase order date</label>
          <input id="epod" className="f" type="date" style={{ maxWidth: 340 }} value={poDate} onChange={(e) => setPoDate(e.target.value)} />
          <label className="f" htmlFor="epon">Purchase order number</label>
          <input id="epon" className="f" style={{ maxWidth: 340 }} placeholder="Client's own PO reference, e.g. PO-1042"
            value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
          <label className="f" htmlFor="epof">Replace PO attachment (optional)</label>
          <input id="epof" className="f" type="file" accept=".jpg,.jpeg,.png,.pdf" style={{ maxWidth: 340 }}
            onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {order.attachment_name && !file && (
            <p className="dim" style={{ marginTop: -8, marginBottom: 14, fontSize: 12.5 }}>
              Current file: {order.attachment_name} — <button className="btn sm ghost" onClick={viewAttachment}>View</button>
            </p>
          )}
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
            <button className="btn" disabled={!clean.length || busy} onClick={submit}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </Card>
      )}
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
                  <td className="num right">
                    {peso(i.amount)}
                    {i.status !== "paid" && i.status !== "void" && Number(i.balance_due) !== Number(i.amount) && (
                      <div className="dim" style={{ fontSize: 12.5 }}>Balance: {peso(i.balance_due)}</div>
                    )}
                    {Number(i.total_ewt) > 0 && (
                      <div className="dim" style={{ fontSize: 12.5 }}>Includes {peso(i.total_ewt)} EWT</div>
                    )}
                    {i.ewt_name && (
                      <div className="dim" style={{ fontSize: 12.5 }}>2307 on file</div>
                    )}
                  </td>
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
