import { useState } from "react";
import { api, fmtTime } from "../../api";
import { Card, ErrorBox, Loading, useData, useToast } from "../../components";

export default function Announcements() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { data: clients } = useData<any[]>(() => api.get("/clients"), []);
  const { data: sent, loading, error, reload } = useData<any[]>(() => api.get("/announcements"), []);
  const recipientCount = clients?.length || 0;

  const send = async () => {
    if (!window.confirm(`Send this announcement to all ${recipientCount} customer(s) in the directory? This can't be undone.`))
      return;
    setBusy(true);
    try {
      const res = await api.post<{ sent: number; attempted: number }>("/announcements", {
        subject: subject.trim(),
        body: body.trim(),
      });
      toast(`Sent to ${res.sent} of ${res.attempted} customer(s).`);
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
      <p className="pagesub">Compose a message and email it to every customer in the directory.</p>

      <Card title="New announcement" hint={`sends to ${recipientCount} customer(s)`}>
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
            <thead><tr><th>Sent</th><th>Subject</th><th>By</th><th className="right">Recipients</th></tr></thead>
            <tbody>
              {(sent || []).map((a) => (
                <tr key={a.id}>
                  <td className="num">{fmtTime(a.created_at)}</td>
                  <td>{a.subject}</td>
                  <td>{a.sent_by_name || "—"}</td>
                  <td className="num right">{a.recipient_count}</td>
                </tr>
              ))}
              {!sent?.length && <tr><td colSpan={4} className="empty">No announcements sent yet.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
