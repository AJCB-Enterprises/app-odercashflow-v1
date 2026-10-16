import { useEffect, useState } from "react";
import { api, fmtTime } from "../../api";
import { Card, ErrorBox, Loading, useData, useToast } from "../../components";

const TYPE_INFO: Record<string, { title: string; hint: string; name: string; placeholders: string; firstLabel: string | null }> = {
  payment: {
    title: "Payment reminders", hint: "emails carry a secure, tokenized upload link", name: "Payment",
    placeholders: "{{contact}} {{invoice}} {{amount}} {{due}}", firstLabel: "Start reminding (days before due)",
  },
  order: {
    title: "Order reminders", hint: "for orders awaiting review", name: "Order",
    placeholders: "{{contact}} {{order}}", firstLabel: null,
  },
  ewt: {
    title: "BIR 2307 reminders", hint: "asks for the Form 2307 once tax was withheld on a payment", name: "BIR 2307",
    placeholders: "{{contact}} {{invoice}} {{ewt}}", firstLabel: "First request (days after the tax withheld was recorded)",
  },
};

// What the 2307 reminder would do on its next run, so the size of the first batch is visible before switching it on.
function EwtPreview({ refreshKey }: { refreshKey: unknown }) {
  const { data } = useData<any>(() => api.get("/reminders/ewt-preview"), [refreshKey]);
  if (!data) return null;
  return (
    <p className="dim" style={{ marginTop: 10, fontSize: 12.5 }}>
      On the next run: <strong>{data.due_invoices}</strong> invoice(s) across <strong>{data.due_clients}</strong> client(s) would be emailed.
      {" "}{data.lacking_total} paid invoice(s) are missing a 2307 in total
      {data.lacking_no_email + data.lacking_in_person > 0 &&
        `; ${data.lacking_no_email} have no client email and ${data.lacking_in_person} are in-person clients, so they won't get an email`}.
    </p>
  );
}

function SettingsCard({ s, onSaved, onRan }: { s: any; onSaved: () => void; onRan: () => void }) {
  const toast = useToast();
  const [previewTick, setPreviewTick] = useState(0);
  const [form, setForm] = useState({ ...s, send_time: String(s.send_time).slice(0, 5) });
  useEffect(() => setForm({ ...s, send_time: String(s.send_time).slice(0, 5) }), [s]);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const info = TYPE_INFO[s.type];
  const isEwt = s.type === "ewt";

  const save = async () => {
    try {
      await api.put(`/reminders/settings/${s.type}`, {
        days_before: Number(form.days_before),
        frequency_days: Number(form.frequency_days),
        send_time: form.send_time,
        template: form.template,
        is_enabled: !!form.is_enabled,
        ...(isEwt ? { max_reminders: Number(form.max_reminders) } : {}),
      });
      toast(`${info.name} reminder settings saved.`);
      setPreviewTick((t) => t + 1);
      onSaved();
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const runNow = async () => {
    try {
      if (isEwt) {
        const p = await api.get<{ due_invoices: number; due_clients: number }>("/reminders/ewt-preview");
        if (!p.due_invoices) return toast("No 2307 reminders are due right now.");
        if (!window.confirm(`Email ${p.due_clients} client(s) now, asking for the 2307 on ${p.due_invoices} invoice(s)?`)) return;
      }
      const res = await api.post<{ sent: number; skipped_reason?: string }>(`/reminders/run/${s.type}`);
      toast(res.sent > 0
        ? `Sent ${res.sent} ${s.type} reminder email(s).`
        : `No ${s.type} reminders due right now${res.skipped_reason ? ` (${res.skipped_reason})` : " — the frequency ledger prevents duplicates"}.`);
      setPreviewTick((t) => t + 1);
      onRan();
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  return (
    <Card
      title={info.title}
      hint={info.hint}
    >
      <div className="grid2">
        {info.firstLabel && (
          <div>
            <label className="f" htmlFor={`db-${s.type}`}>{info.firstLabel}</label>
            <input id={`db-${s.type}`} className="f num" type="number" min={0} max={60}
              value={form.days_before} onChange={(e) => set("days_before", e.target.value)} />
          </div>
        )}
        <div>
          <label className="f" htmlFor={`fr-${s.type}`}>Resend every (days)</label>
          <input id={`fr-${s.type}`} className="f num" type="number" min={1} max={30}
            value={form.frequency_days} onChange={(e) => set("frequency_days", e.target.value)} />
        </div>
        {isEwt && (
          <div>
            <label className="f" htmlFor={`mx-${s.type}`}>Stop after (reminders per invoice)</label>
            <input id={`mx-${s.type}`} className="f num" type="number" min={1} max={12}
              value={form.max_reminders ?? ""} onChange={(e) => set("max_reminders", e.target.value)} />
          </div>
        )}
        <div>
          <label className="f" htmlFor={`st-${s.type}`}>Send time ({s.timezone})</label>
          <input id={`st-${s.type}`} className="f num" type="time" value={form.send_time}
            onChange={(e) => set("send_time", e.target.value)} />
        </div>
        <div>
          <label className="f" htmlFor={`en-${s.type}`}>Enabled</label>
          <select id={`en-${s.type}`} className="f" value={form.is_enabled ? "yes" : "no"}
            onChange={(e) => set("is_enabled", e.target.value === "yes")}>
            <option value="yes">Yes — send automatically</option>
            <option value="no">No — paused</option>
          </select>
        </div>
      </div>
      <label className="f" htmlFor={`tp-${s.type}`}>Message template</label>
      <textarea id={`tp-${s.type}`} className="f" rows={3} value={form.template}
        onChange={(e) => set("template", e.target.value)} />
      <p className="dim" style={{ marginTop: 6, fontSize: 12.5 }}>
        Placeholders: {info.placeholders}
      </p>
      {isEwt && <EwtPreview refreshKey={`${s.updated_at}-${previewTick}`} />}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button className="btn" onClick={save}>Save settings</button>
        <button className="btn ghost" onClick={runNow}>Run now</button>
      </div>
    </Card>
  );
}

export default function Reminders() {
  const { data, error, loading, reload } = useData<any[]>(() => api.get("/reminders/settings"), []);
  const logs = useData<any[]>(() => api.get("/reminders/logs?limit=25"), []);

  return (
    <>
      <h1 className="page">Reminder scheduling</h1>
      <p className="pagesub">
        Automated reminder emails to clients for payments, orders, and BIR Form 2307 requests — frequency,
        timing, and message template. The worker checks every 15 minutes; "Run now" dispatches immediately.
      </p>
      {error && <ErrorBox msg={error} />}
      {loading ? <Loading /> : (data || []).map((s) => <SettingsCard key={s.type} s={s} onSaved={reload} onRan={logs.reload} />)}

      <Card title="Recent sends" hint="the reminder ledger" pad={false}>
        {logs.loading ? <Loading /> : (
          <table className="ledger">
            <thead><tr><th>Sent</th><th>Type</th><th>Client</th><th>Ref</th><th>To</th></tr></thead>
            <tbody>
              {(logs.data || []).map((l) => (
                <tr key={l.id}>
                  <td className="num">{fmtTime(l.sent_at)}</td>
                  <td><span className={"chip " + ({ payment: "blue", order: "amber", ewt: "orange" } as Record<string, string>)[l.type]}>{l.type === "ewt" ? "2307" : l.type}</span></td>
                  <td>{l.company_name}</td>
                  <td className="num">{l.invoice_no || l.order_no || "—"}</td>
                  <td className="num">{l.sent_to}</td>
                </tr>
              ))}
              {!logs.data?.length && <tr><td colSpan={5} className="empty">No reminders sent yet.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
