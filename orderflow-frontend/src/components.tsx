import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, daysUntil } from "./api";

/* ---- Card ---- */
export function Card({ title, hint, pad = true, children }: {
  title?: string; hint?: string; pad?: boolean; children: React.ReactNode;
}) {
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

/* ---- status chips ---- */
export const InvoiceChip = ({ inv }: { inv: { status: string; due_date: string; is_overdue?: boolean } }) => {
  const overdue = inv.is_overdue ?? (inv.status === "unpaid" && daysUntil(inv.due_date) < 0);
  if (inv.status === "paid") return <span className="chip green">Paid</span>;
  if (inv.status === "receipt_uploaded") return <span className="chip blue">Receipt uploaded</span>;
  if (inv.status === "void") return <span className="chip gray">Void</span>;
  return overdue ? <span className="chip red">Overdue</span> : <span className="chip amber">Unpaid</span>;
};

export const OrderChip = ({ status }: { status: string }) =>
  status === "approved" ? <span className="chip green">Approved</span>
  : status === "rejected" ? <span className="chip red">Rejected</span>
  : status === "cancelled" ? <span className="chip gray">Cancelled</span>
  : <span className="chip amber">Pending review</span>;

/* ---- toast ---- */
const ToastCtx = createContext<(msg: string, isError?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);
  const timer = useRef<number>();
  const show = useCallback((msg: string, isError = false) => {
    setToast({ msg, err: isError });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div className={"toast" + (toast.err ? " err" : "")} role="status">{toast.msg}</div>}
    </ToastCtx.Provider>
  );
}

/* ---- data loading hook ---- */
export function useData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    load()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

export const Loading = () => <div className="empty">Loading…</div>;
export const ErrorBox = ({ msg }: { msg: string }) => <div className="errbox">{msg}</div>;

/* ---- payment terms / VAT status: shared option lists ---- */
export const PAYMENT_TERM_OPTIONS = [
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_45", label: "Net 45" },
  { value: "cod", label: "COD" },
];
export const VAT_STATUS_OPTIONS = [
  { value: "vat_exempt", label: "SO/ DR" },
  { value: "vat_inclusive", label: "VAT-Inclusive" },
  { value: "zero_rated", label: "Zero-Rated" },
];

/** One email per line or comma-separated — used for the "additional emails" fields. */
const parseEmailList = (raw: string): string[] =>
  raw.split(/[\n,]+/).map((e) => e.trim()).filter(Boolean);

/* ---- new client form (admin: can assign an agent; agent: auto-assigned to self) ---- */
export function NewClientForm({ agents, onDone }: { agents?: { id: string; full_name: string }[]; onDone: () => void }) {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [agentId, setAgentId] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("net_30");
  const [vatStatus, setVatStatus] = useState("vat_inclusive");
  const [extraEmails, setExtraEmails] = useState("");
  const [tin, setTin] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async () => {
    setBusy(true);
    try {
      await api.post("/clients", {
        company_name: companyName.trim(),
        contact_name: contactName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        payment_terms: paymentTerms,
        vat_status: vatStatus,
        extra_emails: parseEmailList(extraEmails),
        tin: tin.trim(),
        ...(agents ? { agent_id: agentId || null } : {}),
      });
      toast(`${companyName} added to the directory.`);
      onDone();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const valid = companyName.trim() && contactName.trim() && email.trim() && phone.trim() && address.trim() && tin.trim();

  return (
    <Card title="New client">
      <label className="f" htmlFor="ncc">Company name</label>
      <input id="ncc" className="f" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
      <label className="f" htmlFor="ncn">Contact name</label>
      <input id="ncn" className="f" required value={contactName} onChange={(e) => setContactName(e.target.value)} />
      <label className="f" htmlFor="nce">Email</label>
      <input id="nce" className="f" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="f" htmlFor="ncxe">Additional emails (optional)</label>
      <textarea id="ncxe" className="f" rows={2} value={extraEmails} onChange={(e) => setExtraEmails(e.target.value)}
        placeholder="One per line or comma-separated — reminders and announcements go to all of them." />
      <label className="f" htmlFor="ncp">Phone</label>
      <input id="ncp" className="f" required value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label className="f" htmlFor="nca">Address</label>
      <input id="nca" className="f" required value={address} onChange={(e) => setAddress(e.target.value)} />
      <label className="f" htmlFor="ntin">Tax Identification Number (TIN)</label>
      <input id="ntin" className="f" required value={tin} onChange={(e) => setTin(e.target.value)} />
      <label className="f" htmlFor="nct">Payment terms</label>
      <select id="nct" className="f" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}>
        {PAYMENT_TERM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <label className="f" htmlFor="ncv">VAT status</label>
      <select id="ncv" className="f" value={vatStatus} onChange={(e) => setVatStatus(e.target.value)}>
        {VAT_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {agents && (
        <>
          <label className="f" htmlFor="ncg">Assign to agent</label>
          <select id="ncg" className="f" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Unassigned</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
        </>
      )}
      <button className="btn" disabled={!valid || busy} onClick={submit} style={{ marginTop: 12 }}>
        {busy ? "Adding…" : "Add client"}
      </button>
    </Card>
  );
}

/** BIR COR 2303 / PEZA Certificate — uploads immediately on file selection. */
function ClientDocUpload({ clientId, type, label, currentName, onUploaded }: {
  clientId: string; type: "bir_cor" | "peza_cert"; label: string; currentName?: string;
  onUploaded: (name: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.postForm(`/clients/${clientId}/documents/${type}`, form);
      onUploaded(file.name);
      toast(`${label} uploaded.`);
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const view = async () => {
    try {
      await api.openBlob(`/clients/${clientId}/documents/${type}`);
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <label className="f">{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {currentName
          ? <><span className="dim" style={{ fontSize: 13 }}>{currentName}</span>
              <button className="btn sm ghost" type="button" onClick={view}>View</button></>
          : <span className="dim" style={{ fontSize: 13 }}>Not uploaded</span>}
        <input type="file" accept=".jpg,.jpeg,.png,.pdf" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      </div>
    </div>
  );
}

/* ---- edit client form (admin only, can reassign agent) ---- */
export function EditClientForm({ client, agents, onDone, onCancel }: {
  client: { id: string; company_name: string; contact_name: string; email: string; phone?: string; address?: string; agent_id?: string; notes?: string; payment_terms?: string; vat_status?: string; extra_emails?: string[]; tin?: string; bir_cor_name?: string; peza_cert_name?: string };
  agents: { id: string; full_name: string }[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [companyName, setCompanyName] = useState(client.company_name);
  const [contactName, setContactName] = useState(client.contact_name);
  const [email, setEmail] = useState(client.email);
  const [phone, setPhone] = useState(client.phone || "");
  const [address, setAddress] = useState(client.address || "");
  const [agentId, setAgentId] = useState(client.agent_id || "");
  const [notes, setNotes] = useState(client.notes || "");
  const [paymentTerms, setPaymentTerms] = useState(client.payment_terms || "net_30");
  const [vatStatus, setVatStatus] = useState(client.vat_status || "vat_inclusive");
  const [extraEmails, setExtraEmails] = useState((client.extra_emails || []).join("\n"));
  const [tin, setTin] = useState(client.tin || "");
  const [birCorName, setBirCorName] = useState(client.bir_cor_name || "");
  const [pezaCertName, setPezaCertName] = useState(client.peza_cert_name || "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async () => {
    setBusy(true);
    try {
      await api.patch(`/clients/${client.id}`, {
        company_name: companyName.trim(),
        contact_name: contactName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        notes: notes.trim() || undefined,
        agent_id: agentId || null,
        payment_terms: paymentTerms,
        vat_status: vatStatus,
        extra_emails: parseEmailList(extraEmails),
        tin: tin.trim(),
      });
      toast("Client details updated.");
      onDone();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const valid = companyName.trim() && contactName.trim() && email.trim() && phone.trim() && address.trim() && tin.trim();

  return (
    <Card title="Edit client">
      <label className="f" htmlFor="ecc">Company name</label>
      <input id="ecc" className="f" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
      <label className="f" htmlFor="ecn">Contact name</label>
      <input id="ecn" className="f" required value={contactName} onChange={(e) => setContactName(e.target.value)} />
      <label className="f" htmlFor="ece">Email</label>
      <input id="ece" className="f" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="f" htmlFor="ecxe">Additional emails (optional)</label>
      <textarea id="ecxe" className="f" rows={2} value={extraEmails} onChange={(e) => setExtraEmails(e.target.value)}
        placeholder="One per line or comma-separated — reminders and announcements go to all of them." />
      <label className="f" htmlFor="ecp">Phone</label>
      <input id="ecp" className="f" required value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label className="f" htmlFor="eca">Address</label>
      <input id="eca" className="f" required value={address} onChange={(e) => setAddress(e.target.value)} />
      <label className="f" htmlFor="etin">Tax Identification Number (TIN)</label>
      <input id="etin" className="f" required value={tin} onChange={(e) => setTin(e.target.value)} />
      <ClientDocUpload clientId={client.id} type="bir_cor" label="BIR COR 2303" currentName={birCorName} onUploaded={setBirCorName} />
      <ClientDocUpload clientId={client.id} type="peza_cert" label="PEZA Certificate (Zero-Rated clients)" currentName={pezaCertName} onUploaded={setPezaCertName} />
      <label className="f" htmlFor="ect">Payment terms</label>
      <select id="ect" className="f" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}>
        {PAYMENT_TERM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <label className="f" htmlFor="ecv">VAT status</label>
      <select id="ecv" className="f" value={vatStatus} onChange={(e) => setVatStatus(e.target.value)}>
        {VAT_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <label className="f" htmlFor="ecg">Assign to agent</label>
      <select id="ecg" className="f" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
        <option value="">Unassigned</option>
        {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
      </select>
      <label className="f" htmlFor="ecm">Notes</label>
      <textarea id="ecm" className="f" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button className="btn" disabled={!valid || busy} onClick={submit}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button className="btn ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </Card>
  );
}
