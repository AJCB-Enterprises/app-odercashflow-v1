import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, fmtDate, peso } from "../../api";
import { Card, EditClientForm, ErrorBox, InvoiceChip, Loading, NewClientForm, OrderChip, useData, useToast } from "../../components";

export function Directory() {
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const { data, error, loading, reload } = useData<any[]>(
    () => api.get(`/clients${q ? `?search=${encodeURIComponent(q)}` : ""}`),
    [q]
  );
  const navigate = useNavigate();
  const { data: agents } = useData<any[]>(() => api.get("/agents"), []);

  return (
    <>
      <h1 className="page">Customer directory</h1>
      <p className="pagesub">Central, searchable customer database — contact details, order history, and invoice status per client.</p>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <input className="f" style={{ maxWidth: 380, marginBottom: 0 }} value={q}
          placeholder="Search by name, contact, email, or phone…"
          onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
        <button className="btn sm" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ New client"}
        </button>
      </div>
      {showForm && (
        <NewClientForm
          agents={agents || []}
          onDone={() => { setShowForm(false); reload(); }}
        />
      )}
      {error && <ErrorBox msg={error} />}
      <Card pad={false}>
        {loading ? <Loading /> : (
          <table className="ledger">
            <thead><tr><th>Client</th><th>Contact</th><th>Address</th><th>Agent</th><th>Orders</th><th>Open invoices</th></tr></thead>
            <tbody>
              {(data || []).map((c) => (
                <tr key={c.id} className="rowbtn" onClick={() => navigate(`/admin/directory/${c.id}`)}>
                  <td className="strong">{c.company_name}</td>
                  <td>{c.contact_name}<div className="dim num">{c.email} · {c.phone || "no phone"}</div></td>
                  <td className="dim">{c.address || "—"}</td>
                  <td>{c.agent_name || "—"}</td>
                  <td className="num">{c.order_count}</td>
                  <td>
                    {Number(c.open_invoice_count) > 0
                      ? <span className="chip amber">{c.open_invoice_count} open · {peso(c.open_invoice_total)}</span>
                      : <span className="chip green">Clear</span>}
                  </td>
                </tr>
              ))}
              {!data?.length && <tr><td colSpan={6} className="empty">No customers match{q ? ` "${q}"` : ""}.</td></tr>}
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
  const toast = useToast();
  const { data, error, loading, reload } = useData<any>(() => api.get(`/clients/${id}`), [id]);
  const { data: agents } = useData<any[]>(() => api.get("/agents"), []);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox msg={error || "Client not found"} />;
  const { client, orders, invoices, pending_invoices } = data;

  const deleteClient = async () => {
    setMenuOpen(false);
    if (!window.confirm(`Delete ${client.company_name}? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/clients/${client.id}`);
      toast(`${client.company_name} deleted.`);
      navigate("/admin/directory");
    } catch (e: any) {
      toast(e.message, true);
      setDeleting(false);
    }
  };

  const viewReceipt = async (invoiceId: string) => {
    try {
      await api.openBlob(`/invoices/${invoiceId}/receipt`);
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const resendReminder = async (invoiceId: string, invoiceNo: string) => {
    try {
      await api.post(`/invoices/${invoiceId}/resend-reminder`);
      toast(`Payment reminder resent for ${invoiceNo}.`);
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const viewEwt = async (invoiceId: string) => {
    try {
      await api.openBlob(`/invoices/${invoiceId}/receipt/ewt`);
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const sendEwtLink = async (invoiceId: string, invoiceNo: string) => {
    try {
      await api.post(`/invoices/${invoiceId}/ewt-link`);
      toast(`BIR 2307 request sent for ${invoiceNo}.`);
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  return (
    <>
      <button className="back" onClick={() => navigate("/admin/directory")}>← Back to directory</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="page">{client.company_name}</h1>
          <p className="pagesub">
            {client.contact_name} · {client.email} · {client.phone || "no phone"} · {client.address || "no address"} · Agent: {client.agent_name || "—"}
          </p>
          {client.extra_emails?.length > 0 && (
            <p className="dim" style={{ marginTop: -8 }}>Also cc'd: {client.extra_emails.join(", ")}</p>
          )}
        </div>
        <div className="menu-wrap">
          <button className="btn sm" disabled={deleting} onClick={() => { setEditing((s) => !s); setMenuOpen(false); }}>
            {editing ? "Close edit" : "Edit client"}
          </button>
          <button className="btn sm menu-caret" aria-label="More client actions" disabled={deleting}
            onClick={() => setMenuOpen((s) => !s)}>▾</button>
          {menuOpen && (
            <div className="menu">
              <button className="red" onClick={deleteClient}>Delete client</button>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <EditClientForm
          client={client}
          agents={agents || []}
          onDone={() => { setEditing(false); reload(); }}
          onCancel={() => setEditing(false)}
        />
      )}

      <Card title="Pending invoices" hint="shown when reviewing this account" pad={false}>
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
          <thead><tr><th>Invoice</th><th className="right">Amount</th><th>Due</th><th>Status</th><th /></tr></thead>
          <tbody>
            {invoices.map((i: any) => (
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
                <td className="right" style={{ whiteSpace: "nowrap" }}>
                  {i.receipt_name && (
                    <>
                      <button className="btn sm ghost" onClick={() => viewReceipt(i.id)}>View receipt</button>{" "}
                    </>
                  )}
                  {i.status === "unpaid" && (
                    <>
                      <button className="btn sm ghost" onClick={() => resendReminder(i.id, i.invoice_no)}>Resend reminder</button>{" "}
                    </>
                  )}
                  {i.ewt_name && (
                    <>
                      <button className="btn sm ghost" onClick={() => viewEwt(i.id)}>View 2307</button>{" "}
                    </>
                  )}
                  {i.status !== "void" && (
                    <button className="btn sm ghost" onClick={() => sendEwtLink(i.id, i.invoice_no)}>Send 2307 link</button>
                  )}
                </td>
              </tr>
            ))}
            {!invoices.length && <tr><td colSpan={5} className="empty">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}
