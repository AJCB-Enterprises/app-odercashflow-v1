import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, fmtDate, peso } from "../../api";
import { Card, ErrorBox, InvoiceChip, Loading, OrderChip, useData } from "../../components";

export function Directory() {
  const [q, setQ] = useState("");
  const { data, error, loading } = useData<any[]>(
    () => api.get(`/clients${q ? `?search=${encodeURIComponent(q)}` : ""}`),
    [q]
  );
  const navigate = useNavigate();

  return (
    <>
      <h1 className="page">Customer directory</h1>
      <p className="pagesub">Central, searchable customer database — contact details, order history, and invoice status per client.</p>
      <input className="f" style={{ maxWidth: 380, marginBottom: 16 }} value={q}
        placeholder="Search by name, contact, email, or phone…"
        onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
      {error && <ErrorBox msg={error} />}
      <Card pad={false}>
        {loading ? <Loading /> : (
          <table className="ledger">
            <thead><tr><th>Client</th><th>Contact</th><th>Agent</th><th>Orders</th><th>Open invoices</th></tr></thead>
            <tbody>
              {(data || []).map((c) => (
                <tr key={c.id} className="rowbtn" onClick={() => navigate(`/admin/directory/${c.id}`)}>
                  <td className="strong">{c.company_name}</td>
                  <td>{c.contact_name}<div className="dim num">{c.email} · {c.phone || "no phone"}</div></td>
                  <td>{c.agent_name || "—"}</td>
                  <td className="num">{c.order_count}</td>
                  <td>
                    {Number(c.open_invoice_count) > 0
                      ? <span className="chip amber">{c.open_invoice_count} open · {peso(c.open_invoice_total)}</span>
                      : <span className="chip green">Clear</span>}
                  </td>
                </tr>
              ))}
              {!data?.length && <tr><td colSpan={5} className="empty">No customers match{q ? ` "${q}"` : ""}.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

export function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, loading } = useData<any>(() => api.get(`/clients/${id}`), [id]);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox msg={error || "Client not found"} />;
  const { client, orders, invoices, pending_invoices } = data;

  return (
    <>
      <button className="back" onClick={() => navigate("/admin/directory")}>← Back to directory</button>
      <h1 className="page">{client.company_name}</h1>
      <p className="pagesub">
        {client.contact_name} · {client.email} · {client.phone || "no phone"} · Agent: {client.agent_name || "—"}
      </p>

      <Card title="Pending invoices" hint="shown when reviewing this account" pad={false}>
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
            {!pending_invoices.length && <tr><td colSpan={4} className="empty">No pending invoices for this client.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card title="Order history" pad={false}>
        <table className="ledger">
          <thead><tr><th>Order</th><th className="right">Total</th><th>Submitted</th><th>Status</th></tr></thead>
          <tbody>
            {orders.map((o: any) => (
              <tr key={o.id} className="rowbtn" onClick={() => navigate(`/admin/orders/${o.id}`)}>
                <td className="num strong">{o.order_no}</td>
                <td className="num right">{peso(o.total)}</td>
                <td className="num">{fmtDate(o.created_at)}</td>
                <td><OrderChip status={o.status} /></td>
              </tr>
            ))}
            {!orders.length && <tr><td colSpan={4} className="empty">No orders yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card title="Invoice status" pad={false}>
        <table className="ledger">
          <thead><tr><th>Invoice</th><th className="right">Amount</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {invoices.map((i: any) => (
              <tr key={i.id}>
                <td className="num strong">{i.invoice_no}</td>
                <td className="num right">{peso(i.amount)}</td>
                <td className="num">{fmtDate(i.due_date)}</td>
                <td><InvoiceChip inv={i} /></td>
              </tr>
            ))}
            {!invoices.length && <tr><td colSpan={4} className="empty">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}
