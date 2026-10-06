import { useState } from "react";
import { api, fmtTime } from "../../api";
import { Card, ErrorBox, Loading, useData, useToast } from "../../components";

// Broadcasts sent before the breakdown was recorded have null counts — "—", not "0".
const notSentLabel = (a: any) => {
  if (a.no_email_count == null || a.failed_count == null) return "—";
  const parts = [a.no_email_count ? `${a.no_email_count} no email` : "", a.failed_count ? `${a.failed_count} failed` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "None";
};

export default function Announcements() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { data: clients } = useData<any[]>(() => api.get("/clients"), []);
  const { data: sent, loading, error, reload } = useData<any[]>(() => api.get("/announcements"), []);
  // Only a client with an email address (primary or extra) can receive this —
  // the rest are skipped by the server, so don't count them as recipients.
  const emailable = (clients || []).filter((c) => Boolean(c.email) || (c.extra_emails || []).some(Boolean));
  const recipientCount = emailable.length;
  const noEmailCount = (clients?.length || 0) - recipientCount;

  const send = async () => {
    const skipNote = noEmailCount > 0 ? ` ${noEmailCount} customer(s) with no email on file will be skipped.` : "";
    if (!window.confirm(`Send this announcement to ${recipientCount} customer(s)?${skipNote} This can't be undone.`))
      return;
    setBusy(true);
    try {
      const res = await api.post<{ sent: number; attempted: number; no_email: number; failed: number }>("/announcements", {
        subject: subject.trim(),
        body: body.trim(),
      });
      const notSent = [
        res.no_email ? `${res.no_email} had no email on file` : "",
        res.failed ? `${res.failed} failed to send` : "",
      ].filter(Boolean);
      toast(`Sent to ${res.sent} of ${res.attempted} customer(s)${notSent.length ? ` — ${notSent.join(", ")}` : ""}.`, res.failed > 0);
      setSubject("");
      setBody("");
      reload();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const valid = subject.trim() && body.trim() && recipientCount > 0;

  return (
    <>
      <h1 className="page">Announcements</h1>
      <p className="pagesub">
        Compose a message and email it to every customer in the directory that has an email address on file.
        {noEmailCount > 0 && ` ${noEmailCount} customer(s) have no email and will be skipped — add one in the Customer directory to include them.`}
      </p>

      <Card title="New announcement" hint={`sends to ${recipientCount} of ${clients?.length || 0} customer(s)`}>
        <label className="f" htmlFor="ansub">Subject</label>
        <input id="ansub" className="f" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <label className="f" htmlFor="anbody">Message</label>
        <textarea id="anbody" className="f" rows={6} value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="Use {{contact}} to address each customer by name." />
        <p className="dim" style={{ marginTop: 6, fontSize: 12.5 }}>Placeholders: {"{{contact}}"}</p>
        <button className="btn" disabled={!valid || busy} onClick={send} style={{ marginTop: 12 }}>
          {busy ? "Sending…" : "Send to all customers"}
        </button>
      </Card>

      {error && <ErrorBox msg={error} />}
      <Card title="Past announcements" pad={false}>
        {loading ? <Loading /> : (
          <table className="ledger">
            <thead><tr><th>Sent</th><th>Subject</th><th>By</th><th className="right">Recipients</th><th>Not sent</th></tr></thead>
            <tbody>
              {(sent || []).map((a) => (
                <tr key={a.id}>
                  <td className="num">{fmtTime(a.created_at)}</td>
                  <td>{a.subject}</td>
                  <td>{a.sent_by_name || "—"}</td>
                  <td className="num right">{a.recipient_count}</td>
                  <td className="dim">{notSentLabel(a)}</td>
                </tr>
              ))}
              {!sent?.length && <tr><td colSpan={5} className="empty">No announcements sent yet.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
