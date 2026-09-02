import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { Card, ErrorBox, Loading, useData } from "../components";

/**
 * Public, standalone BIR Form 2307 (EWT) upload page, reached from a link
 * Admin sends on request (/e/:token). Unlike the payment-receipt link, this
 * one keeps working even after the invoice is fully paid — for clients who
 * settle payment first and send the form later.
 */
export default function EwtUpload() {
  const { token } = useParams();
  const { data, error, loading } = useData<any>(() => api.get(`/e/${token}`, false), [token]);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  if (loading) return <div className="centerwrap"><Loading /></div>;
  if (error || !data)
    return (
      <div className="centerwrap">
        <Card title="Link not available">
          <p>This link is invalid or has expired. Please ask your billing contact for a new one.</p>
        </Card>
      </div>
    );

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      const res = await api.upload<{ message: string }>(`/e/${token}`, file);
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
      <Card title="BIR Form 2307 upload" hint="secure link · no login required">
        <table className="ledger" style={{ margin: "6px 0 14px" }}>
          <tbody>
            <tr><td className="dim">Billed to</td><td className="strong">{data.billed_to}</td></tr>
            <tr><td className="dim">Invoice</td><td className="num strong">{data.invoice_no}</td></tr>
          </tbody>
        </table>
        <p className="dim" style={{ marginBottom: 14 }}>{data.note}</p>

        {done ? (
          <div style={{ textAlign: "center", padding: "18px 0" }}>
            <span className="stamp blue">Form received</span>
            <p style={{ marginTop: 16 }}>{done}</p>
          </div>
        ) : data.already_submitted ? (
          <div style={{ textAlign: "center", padding: "18px 0" }}>
            <span className="chip blue">A Form 2307 is already on file for this invoice</span>
            <p className="dim" style={{ marginTop: 10 }}>
              You can upload a replacement below if needed.
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
                    Drop your BIR Form 2307 here or click to choose
                  </div>
                  <div className="dim" style={{ marginTop: 4 }}>JPG, PNG, or PDF · max 5 MB</div>
                </>
              )}
            </div>
            {err && <ErrorBox msg={err} />}
            <button className="btn" style={{ marginTop: 14 }} disabled={!file || busy} onClick={submit}>
              {busy ? "Uploading…" : "Submit form"}
            </button>
          </>
        )}
      </Card>
    </div>
  );
}
