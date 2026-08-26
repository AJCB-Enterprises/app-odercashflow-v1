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
      <p className="pagesub">Review submitted orders and purchase orders. Open one to approve or reject it.</p>
      {error && <ErrorBox msg={error} />}
      <Card pad={false}>
        {loading ? <Loading /> : (
          <table className="ledger">
            <thead>
              <tr><th>Order</th><th>Client</th><th>Agent</th><th className="right">Total</th><th>Submitted</th><th>Status</th></tr>
            </thead>
            <tbody>
              {(data || []).map((o) => (
                <tr key={o.id} className="rowbtn" onClick={() => navigate(`/admin/orders/${o.id}`)}>
                  <td className="num strong">{o.order_no}</td>
                  <td>{o.company_name}</td>
                  <td>{o.agent_name || <span className="dim">—</span>}</td>
                  <td className="num right">{peso(o.total)}</td>
                  <td className="num">{fmtDate(o.created_at)}</td>
                  <td><OrderChip status={o.status} /></td>
                </tr>
              ))}
              {!data?.length && <tr><td colSpan={6} className="empty">No orders yet.</td></tr>}
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
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useData<any>(() => api.get(`/orders/${id}`), [id]);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox msg={error || "Order not found"} />;
  const { order, items, pending_invoices } = data;
  const total = items.reduce((s: number, it: any) => s + Number(it.qty) * Number(it.unit_price), 0);

  const viewAttachment = async (orderId: string) => {
    try {
      await api.openBlob(`/orders/${orderId}/attachment`);
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const decide = async (action: "approve" | "reject") => {
    setBusy(true);
    try {
      if (action === "approve") {
        const res = await api.post(`/orders/${id}/approve`);
        toast(`${order.order_no} approved · ${res.invoice.invoice_no} issued (${peso(res.invoice.amount)})`);
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
      <div style={{ marginBottom: 16 }}>
        {order.status === "approved" && <span className="stamp green">Approved</span>}
        {order.status === "rejected" && <span className="stamp red">Rejected</span>}
        {order.status === "pending" && <span className="stamp amber">For review</span>}
      </div>

      <Card title="Order details" pad={false}>
        <table className="ledger">
          <thead><tr><th>Item</th><th className="right">Qty</th><th className="right">Unit price</th><th className="right">Line total</th></tr></thead>
          <tbody>
            {items.map((it: any) => (
              <tr key={it.id}>
                <td>{it.description}</td>
                <td className="num right">{Number(it.qty)}</td>
                <td className="num right">{peso(it.unit_price)}</td>
                <td className="num right">{peso(Number(it.qty) * Number(it.unit_price))}</td>
              </tr>
            ))}
            <tr><td className="strong">Total</td><td /><td /><td className="num right strong">{peso(total)}</td></tr>
          </tbody>
        </table>
      </Card>

      <Card title={`Pending invoices — ${order.company_name}`} hint="shown while reviewing" pad={false}>
        <table className="ledger">
          <thead><tr><th>Invoice</th><th className="right">Amount</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {pending_invoices.map((i: any) => (
              <tr key={i.id}>
                <td className="num strong">{i.invoice_no}</td>
                <td className="num right">{peso(i.amount)}</td>
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
          <label className="f" htmlFor="rej">Rejection reason or comment (optional)</label>
          <textarea id="rej" className="f" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Settle outstanding invoice first, or adjust quantities." />
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button className="btn green" disabled={busy} onClick={() => decide("approve")}>Approve order</button>
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
