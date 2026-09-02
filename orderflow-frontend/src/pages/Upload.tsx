import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, fmtDate, peso } from "../api";
import { Card, ErrorBox, Loading, useData } from "../components";

/**
 * Public payment-receipt upload page, reached from the emailed secure link
 * (/u/:token). No login: the token is the credential. This page records proof
 * of payment only — it never processes the payment itself.
 */
export default function Upload() {
  const { token } = useParams();
  const { data, error, loading } = useData<any>(() => api.get(`/u/${token}`, false), [token]);
  const [file, setFile] = useState<File | null>(null);
  const [ewtFile, setEwtFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ewtInputRef = useRef<HTMLInputElement>(null);

  if (loading) return <div className="centerwrap"><Loading /></div>;
  if (error || !data)
    return (
      <div className="centerwrap">
        <Card title="Link not available">
          <p>This link is invalid or has expired. Please use the secure link in your latest reminder email, or contact your agent.</p>
        </Card>
      </div>
    );

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      const res = await api.upload<{ message: string }>(
        `/u/${token}/receipt`,
        file,
        ewtFile ? { ewt_file: ewtFile } : undefined
      );
      setDone(res.message);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const pick = (f: File | undefined | null) => {
    if (f) { setFile(f); setErr(""); }
  };

  return (
    <div className="centerwrap">
      <Card title="Payment receipt upload" hint="secure link · no login required">
        <table className="ledger" style={{ margin: "6px 0 14px" }}>
          <tbody>
            <tr><td className="dim">Billed to</td><td className="strong">{data.billed_to}</td></tr>
            <tr><td className="dim">Invoice</td><td className="num strong">{data.invoice_no}</td></tr>
            <tr><td className="dim">Amount due</td><td className="num strong">{peso(data.amount)}</td></tr>
            <tr>
              <td className="dim">Due date</td>
              <td className="num">
                {fmtDate(data.due_date)}
                {data.is_overdue && <span className="chip red" style={{ marginLeft: 8 }}>Overdue</span>}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="dim" style={{ marginBottom: 14 }}>{data.note}</p>

        {done ? (
          <div style={{ textAlign: "center", padding: "18px 0" }}>
            <span className="stamp blue">Receipt received</span>
            <p style={{ marginTop: 16 }}>{done}</p>
          </div>
        ) : data.status === "receipt_uploaded" ? (
          <div style={{ textAlign: "center", padding: "18px 0" }}>
            <span className="chip blue">Receipt already uploaded</span>
            <p className="dim" style={{ marginTop: 10 }}>
              The billing team is verifying your receipt. You can upload a replacement below if needed.
            </p>
          </div>
        ) : null}

        {!done && (
          <>
            <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
              style={{ display: "none" }} onChange={(e) => pick(e.target.files?.[0])} />
            <div
              className={"uploadbox" + (drag ? " drag" : "")}
              role="button" tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
            >
              {file ? (
                <span className="num strong">{file.name} ✓ ready to submit</span>
              ) : (
                <>
                  <div style={{ fontFamily: "var(--cond)", fontWeight: 700, fontSize: 16, textTransform: "uppercase", letterSpacing: ".05em" }}>
                    Drop receipt here or click to choose
                  </div>
                  <div className="dim" style={{ marginTop: 4 }}>JPG, PNG, or PDF · max 5 MB</div>
                </>
              )}
            </div>

            <label className="f" htmlFor="ewt-file" style={{ marginTop: 14 }}>BIR Form 2307 / EWT (optional)</label>
            <input id="ewt-file" ref={ewtInputRef} className="f" type="file"
              accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
              onChange={(e) => setEwtFile(e.target.files?.[0] || null)} />
            <p className="dim" style={{ marginTop: 4, fontSize: 12.5 }}>
              If you withheld tax on this payment, attach your Certificate of Creditable Tax Withheld.
            </p>

            {err && <ErrorBox msg={err} />}
            <button className="btn" style={{ marginTop: 14 }} disabled={!file || busy} onClick={submit}>
              {busy ? "Uploading…" : "Submit receipt"}
            </button>
          </>
        )}
      </Card>
    </div>
  );
}
