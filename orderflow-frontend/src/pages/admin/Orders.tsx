import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, fmtDate, peso } from "../../api";
import { Card, ErrorBox, InvoiceChip, Loading, OrderChip, PAYMENT_TERM_OPTIONS, useData, useToast, VAT_STATUS_OPTIONS } from "../../components";

export function OrderList() {
  const { data, error, loading } = useData<any[]>(() => api.get("/orders"), []);
  const navigate = useNavigate();

  return (
    <>
      <h1 className="page">Order review</h1>
      <p className="pagesub">Review submitted sales orders. Open one to approve or reject it.</p>
      {error && <ErrorBox msg={error} />}
      <Card pad={false}>
        {loading ? <Loading /> : (
          <table className="ledger">
            <thead>
              <tr><th>Order</th><th>Invoice</th><th>Client</th><th>Agent</th><th className="right">Total</th><th>Submitted</th><th>Status</th></tr>
            </thead>
            <tbody>
              {(data || []).map((o) => (
                <tr key={o.id} className="rowbtn" onClick={() => navigate(`/admin/orders/${o.id}`)}>
                  <td className="num strong">{o.order_no}</td>
                  <td className="num">{o.invoice_no || <span className="dim">—</span>}</td>
                  <td>{o.company_name}</td>
                  <td>{o.agent_name || <span className="dim">—</span>}</td>
                  <td className="num right">{peso(o.total)}</td>
                  <td className="num">{fmtDate(o.created_at)}</td>
                  <td><OrderChip status={o.status} /></td>
                </tr>
              ))}
              {!data?.length && <tr><td colSpan={7} className="empty">No orders yet.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [drNo, setDrNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [reassignTo, setReassignTo] = useState("");
  const [reassigning, setReassigning] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [itemBusy, setItemBusy] = useState(false);
  const { data, error, loading, reload } = useData<any>(() => api.get(`/orders/${id}`), [id]);
  const { data: clients } = useData<any[]>(() => api.get("/clients"), []);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox msg={error || "Order not found"} />;
  const { order, items, pending_invoices } = data;
  const subtotal = items.reduce((s: number, it: any) => s + Number(it.qty) * Number(it.unit_price), 0);
  const discountAmount = Number(order.discount_amount) || 0;
  const total = Math.max(0, subtotal - discountAmount);

  const viewAttachment = async (orderId: string) => {
    try {
      await api.openBlob(`/orders/${orderId}/attachment`);
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const viewClientDoc = async (type: "bir_cor" | "peza_cert") => {
    try {
      await api.openBlob(`/clients/${order.client_id}/documents/${type}`);
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const reassignClient = async () => {
    if (!reassignTo) return;
    setReassigning(true);
    try {
      await api.post(`/orders/${id}/reassign-client`, { client_id: reassignTo });
      toast(`${order.order_no} moved to the selected client.`);
      setReassignTo("");
      reload();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setReassigning(false);
    }
  };

  const voidOrder = async () => {
    if (!window.confirm(`Void ${order.order_no}? This can't be undone.`)) return;
    setVoiding(true);
    try {
      const res = await api.post(`/orders/${id}/void`, { reason: voidReason.trim() || undefined });
      toast(`${order.order_no} voided${res.invoice ? ` — invoice ${res.invoice.invoice_no} marked void` : ""}.`);
      setVoidReason("");
      reload();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setVoiding(false);
    }
  };

  const cancelItem = async (index: number) => {
    if (!window.confirm(`Remove "${items[index].description}" from this order?`)) return;
    setItemBusy(true);
    try {
      const remaining = items
        .filter((_: any, i: number) => i !== index)
        .map((it: any) => ({ description: it.description, qty: Number(it.qty), unit_price: Number(it.unit_price) }));
      const form = new FormData();
      form.append("items", JSON.stringify(remaining));
      if (order.po_date) form.append("po_date", String(order.po_date).slice(0, 10));
      if (order.po_number) form.append("po_number", order.po_number);
      await api.patchForm(`/orders/${id}`, form);
      toast("Item removed from the order.");
      reload();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setItemBusy(false);
    }
  };

  const decide = async (action: "approve" | "reject") => {
    setBusy(true);
    try {
      if (action === "approve") {
        const res = await api.post(
          `/orders/${id}/approve`,
          order.consolidated_invoicing ? { dr_no: drNo.trim() } : { invoice_no: invoiceNo.trim() }
        );
        toast(
          res.invoice
            ? `${order.order_no} approved · ${res.invoice.invoice_no} issued (${peso(res.invoice.amount)})`
            : `${order.order_no} approved — marked delivered. It will be billed on a consolidated invoice.`
        );
      } else {
        await api.post(`/orders/${id}/reject`, { reason: reason.trim() });
        toast(`${order.order_no} rejected${reason.trim() ? " with reason." : "."}`);
      }
      reload();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="back" onClick={() => navigate("/admin/orders")}>← Back to order review</button>
      <h1 className="page">{order.order_no}</h1>
      <p className="pagesub">
        {order.company_name} · submitted {fmtDate(order.created_at)}
        {order.agent_name ? ` by ${order.agent_name}` : ""}
        {" · "}{PAYMENT_TERM_OPTIONS.find((o) => o.value === order.payment_terms)?.label || order.payment_terms}
        {" · "}{VAT_STATUS_OPTIONS.find((o) => o.value === order.vat_status)?.label || order.vat_status}
      </p>
      {(order.po_date || order.po_number || order.attachment_name) && (
        <p className="dim" style={{ marginTop: -8, marginBottom: 16 }}>
          Client's PO: {order.po_number || "no number given"}
          {order.po_date ? ` · dated ${fmtDate(order.po_date)}` : ""}
          {order.attachment_name && (
            <> · <button className="btn sm ghost" onClick={() => viewAttachment(order.id)}>View attached document</button></>
          )}
        </p>
      )}
      {order.dr_no && (
        <p className="dim" style={{ marginTop: -8, marginBottom: 16 }}>DR: {order.dr_no}</p>
      )}
      <div style={{ marginBottom: 16 }}>
        {order.status === "approved" && <span className="stamp green">Approved</span>}
        {order.status === "rejected" && <span className="stamp red">Rejected</span>}
        {order.status === "pending" && <span className="stamp amber">For review</span>}
      </div>

      {order.status === "approved" && (
        <Card title="Client tax documents" hint="for issuing the Sales Invoice">
          <p style={{ marginBottom: 10 }}><span className="dim">TIN:</span> {order.tin || "not on file"}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span className="dim" style={{ minWidth: 150 }}>BIR COR 2303:</span>
            {order.bir_cor_name
              ? <><span>{order.bir_cor_name}</span>
                  <button className="btn sm ghost" onClick={() => viewClientDoc("bir_cor")}>View</button></>
              : <span className="dim">not uploaded</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="dim" style={{ minWidth: 150 }}>PEZA Certificate:</span>
            {order.peza_cert_name
              ? <><span>{order.peza_cert_name}</span>
                  <button className="btn sm ghost" onClick={() => viewClientDoc("peza_cert")}>View</button></>
              : <span className="dim">not uploaded</span>}
          </div>
        </Card>
      )}

      {order.status === "approved" && (
        <Card title="Reassign client" hint="if this order was submitted under the wrong client">
          <p className="dim" style={{ marginBottom: 12 }}>
            Moves this order — and its invoice, if one exists — to the client you pick below. Payment terms
            and VAT status stay as originally set; review them separately if the new client's are different.
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select className="f" style={{ maxWidth: 320, marginBottom: 0 }} value={reassignTo}
              onChange={(e) => setReassignTo(e.target.value)}>
              <option value="">Select the correct client…</option>
              {(clients || []).filter((c) => c.id !== order.client_id).map((c) => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
            <button className="btn sm" disabled={!reassignTo || reassigning} onClick={reassignClient}>
              {reassigning ? "Moving…" : "Move order"}
            </button>
          </div>
        </Card>
      )}

      {order.status === "approved" && (
        <Card title="Void order" hint="when an assigned pre-numbered SI needs to be cancelled">
          <p className="dim" style={{ marginBottom: 12 }}>
            Marks this order cancelled and its invoice void. Only allowed while the invoice is unpaid
            with no payment activity on file at all — if a receipt or payment already exists, resolve
            that first.
          </p>
          <label className="f" htmlFor="voidr">Reason (optional)</label>
          <textarea id="voidr" className="f" rows={2} style={{ maxWidth: 460 }} value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Client cancelled the order." />
          <button className="btn sm red" disabled={voiding} onClick={voidOrder}>
            {voiding ? "Voiding…" : "Void order"}
          </button>
        </Card>
      )}

      <Card title="Order details" pad={false}>
        <table className="ledger">
          <thead>
            <tr>
              <th>Item</th><th className="right">Qty</th><th className="right">Unit price</th><th className="right">Line total</th>
              {order.status === "pending" && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((it: any, i: number) => (
              <tr key={it.id}>
                <td>{it.description}</td>
                <td className="num right">{Number(it.qty)}</td>
                <td className="num right">{peso(it.unit_price)}</td>
                <td className="num right">{peso(Number(it.qty) * Number(it.unit_price))}</td>
                {order.status === "pending" && (
                  <td className="right">
                    <button className="btn sm ghost" disabled={itemBusy || items.length <= 1}
                      title={items.length <= 1 ? "An order needs at least one item — reject it instead" : "Remove this item"}
                      onClick={() => cancelItem(i)}>Cancel item</button>
                  </td>
                )}
              </tr>
            ))}
            {discountAmount > 0 && (
              <tr>
                <td className="dim">Discount</td><td /><td />
                <td className="num right dim">−{peso(discountAmount)}</td>{order.status === "pending" && <td />}
              </tr>
            )}
            <tr><td className="strong">Total</td><td /><td /><td className="num right strong">{peso(total)}</td>{order.status === "pending" && <td />}</tr>
          </tbody>
        </table>
      </Card>

      <Card title={`Pending invoices — ${order.company_name}`} hint="shown while reviewing" pad={false}>
        <table className="ledger">
          <thead><tr><th>Invoice</th><th className="right">Balance due</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {pending_invoices.map((i: any) => (
              <tr key={i.id}>
                <td className="num strong">{i.invoice_no}</td>
                <td className="num right">{peso(i.balance_due)}</td>
                <td className="num">{fmtDate(i.due_date)}</td>
                <td><InvoiceChip inv={i} /></td>
              </tr>
            ))}
            {!pending_invoices.length && <tr><td colSpan={4} className="empty">This client has no pending invoices.</td></tr>}
          </tbody>
        </table>
      </Card>

      {order.status === "pending" && (
        <Card title="Decision">
          {order.consolidated_invoicing ? (
            <>
              <p className="dim" style={{ marginBottom: 10 }}>
                This client uses consolidated invoicing — approving marks the order delivered. The Sales Invoice
                is generated later, from the client's page, once the whole PO has been delivered.
              </p>
              <label className="f" htmlFor="drn">Delivery Receipt (DR) number (required to approve)</label>
              <input id="drn" className="f" style={{ maxWidth: 340 }} value={drNo}
                onChange={(e) => setDrNo(e.target.value)} placeholder="e.g. DR-2026-0001" />
            </>
          ) : (
            <>
              <label className="f" htmlFor="sin">Sales Invoice number (required to approve)</label>
              <input id="sin" className="f" style={{ maxWidth: 340 }} value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)} placeholder="e.g. SI-2026-0001" />
            </>
          )}
          <label className="f" htmlFor="rej">Rejection reason or comment (optional)</label>
          <textarea id="rej" className="f" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Settle outstanding invoice first, or adjust quantities." />
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button className="btn green"
              disabled={busy || (order.consolidated_invoicing ? !drNo.trim() : !invoiceNo.trim())}
              onClick={() => decide("approve")}>Approve order</button>
            <button className="btn red" disabled={busy} onClick={() => decide("reject")}>Reject order</button>
          </div>
        </Card>
      )}
      {order.status === "rejected" && order.reject_reason && (
        <Card title="Rejection reason"><p>{order.reject_reason}</p></Card>
      )}
    </>
  );
}
