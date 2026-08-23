import { useEffect, useState } from "react";
import { api, fmtTime } from "../../api";
import { Card, ErrorBox, Loading, useData, useToast } from "../../components";

function SettingsCard({ s, onSaved }: { s: any; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ ...s, send_time: String(s.send_time).slice(0, 5) });
  useEffect(() => setForm({ ...s, send_time: String(s.send_time).slice(0, 5) }), [s]);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const isPayment = s.type === "payment";

  const save = async () => {
    try {
      await api.put(`/reminders/settings/${s.type}`, {
        days_before: Number(form.days_before),
        frequency_days: Number(form.frequency_days),
        send_time: form.send_time,
        template: form.template,
        is_enabled: !!form.is_enabled,
      });
      toast(`${isPayment ? "Payment" : "Order"} reminder settings saved.`);
      onSaved();
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const runNow = async () => {
    try {
      const res = await api.post<{ sent: number; skipped_reason?: string }>(`/reminders/run/${s.type}`);
      toast(res.sent > 0
        ? `Sent ${res.sent} ${s.type} reminder email(s).`
        : `No ${s.type} reminders due right now${res.skipped_reason ? ` (${res.skipped_reason})` : " — the frequency ledger prevents duplicates"}.`);
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  return (
    <Card
      title={isPayment ? "Payment reminders" : "Order reminders"}
      hint={isPayment ? "emails carry a secure, tokenized upload link" : "for orders awaiting review"}
    >
      <div className="grid2">
        {isPayment && (
          <div>
            <label className="f" htmlFor={`db-${s.type}`}>Start reminding (days before due)</label>
            <input id={`db-${s.type}`} className="f num" type="number" min={0} max={60}
              value={form.days_before} onChange={(e) => set("days_before", e.target.value)} />
          </div>
        )}
        <div>
          <label className="f" htmlFor={`fr-${s.type}`}>Resend every (days)</label>
          <input id={`fr-${s.type}`} className="f num" type="number" min={1} max={30}
            value={form.frequency_days} onChange={(e) => set("frequency_days", e.target.value)} />
        </div>
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
        Placeholders: {isPayment ? "{{contact}} {{invoice}} {{amount}} {{due}}" : "{{contact}} {{order}}"}
      </p>
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
        Automated reminder emails to clients for payments and orders — frequency, timing, and message
        template. The worker checks every 15 minutes; "Run now" dispatches immediately.
      </p>
      {error && <ErrorBox msg={error} />}
      {loading ? <Loading /> : (data || []).map((s) => <SettingsCard key={s.type} s={s} onSaved={reload} />)}

      <Card title="Recent sends" hint="the reminder ledger" pad={false}>
        {logs.loading ? <Loading /> : (
          <table className="ledger">
            <thead><tr><th>Sent</th><th>Type</th><th>Client</th><th>Ref</th><th>To</th></tr></thead>
            <tbody>
              {(logs.data || []).map((l) => (
                <tr key={l.id}>
                  <td className="num">{fmtTime(l.sent_at)}</td>
                  <td><span className={"chip " + (l.type === "payment" ? "blue" : "amber")}>{l.type}</span></td>
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
