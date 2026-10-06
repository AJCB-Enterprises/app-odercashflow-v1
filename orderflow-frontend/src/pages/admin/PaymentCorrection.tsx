import { useState } from "react";
import { api, fmtTime, peso } from "../../api";
import { ErrorBox, Loading, useData, useToast } from "../../components";
import { paymentWarning } from "./paymentChecks";

// Lists the payment entries recorded against one invoice and lets admin fix an
// entry that was keyed in wrong. The change is audited and needs a reason.
export default function PaymentCorrection({ invoiceId, invoiceAmount, onChanged }: {
  invoiceId: string;
  invoiceAmount: number;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { data, error, loading, reload } = useData<{ payments: any[] }>(() => api.get(`/invoices/${invoiceId}/payments`), [invoiceId]);
  const [editId, setEditId] = useState<string | null>(null);
  const [received, setReceived] = useState("");
  const [ewt, setEwt] = useState("");
  const [discount, setDiscount] = useState("");
  const [crNo, setCrNo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const start = (p: any) => {
    setEditId(p.id);
    setReceived(String(Number(p.amount_received)));
    setEwt(String(Number(p.ewt_amount)));
    setDiscount(String(Number(p.discount_amount)));
    setCrNo(p.collection_receipt_no || "");
    setReason("");
  };

  const save = async (p: any) => {
    const body: Record<string, unknown> = { reason: reason.trim() };
    if ((Number(received) || 0) !== Number(p.amount_received)) body.amount_received = Number(received) || 0;
    if ((Number(ewt) || 0) !== Number(p.ewt_amount)) body.ewt_amount = Number(ewt) || 0;
    if ((Number(discount) || 0) !== Number(p.discount_amount)) body.discount_amount = Number(discount) || 0;
    if (crNo.trim() !== (p.collection_receipt_no || "")) body.collection_receipt_no = crNo.trim() || null;
    if (Object.keys(body).length === 1) return toast("Nothing was changed.", true);

    const warning = paymentWarning(Number(received) || 0, Number(discount) || 0, invoiceAmount);
    if (warning && !window.confirm(`${warning}\n\nSave it anyway?`)) return;

    setBusy(true);
    try {
      const res = await api.patch<{ balance_due: number; status_change: string | null }>(`/invoices/${invoiceId}/payments/${p.id}`, body);
      toast(
        res.status_change === "reopened"
          ? `Payment corrected — the invoice is open again with ${peso(res.balance_due)} still due.`
          : res.status_change === "paid"
            ? "Payment corrected — the invoice is now fully paid."
            : "Payment corrected."
      );
      setEditId(null);
      reload();
      onChanged();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox msg={error || "Couldn't load payments"} />;

  return (
    <div style={{ padding: "4px 0" }}>
      <p className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>
        Payment entries on this invoice. Use Correct only to fix an entry that was keyed in wrong — it needs a reason and is logged.
      </p>
      {data.payments.map((p) => (
        <div key={p.id} style={{ padding: "10px 0", borderTop: "1px solid var(--rule2)" }}>
          {editId === p.id ? (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <span className="inputgroup"><span className="lbl">Received</span>
                  <input className="f num" style={{ width: 110, marginBottom: 0 }} type="number" min={0} step="0.01" value={received} onChange={(e) => setReceived(e.target.value)} /></span>
                <span className="inputgroup"><span className="lbl">EWT</span>
                  <input className="f num" style={{ width: 100, marginBottom: 0 }} type="number" min={0} step="0.01" value={ewt} onChange={(e) => setEwt(e.target.value)} /></span>
                <span className="inputgroup"><span className="lbl">Discount</span>
                  <input className="f num" style={{ width: 100, marginBottom: 0 }} type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></span>
                <span className="inputgroup"><span className="lbl">CR #</span>
                  <input className="f" style={{ width: 130, marginBottom: 0 }} value={crNo} onChange={(e) => setCrNo(e.target.value)} /></span>
              </div>
              <label className="f" style={{ marginTop: 10 }}>Reason for the correction (required)</label>
              <input className="f" style={{ maxWidth: 460 }} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Cash was entered as a discount" />
              <button className="btn sm" disabled={busy || reason.trim().length < 3} onClick={() => save(p)}>{busy ? "Saving…" : "Save correction"}</button>{" "}
              <button className="btn sm ghost" disabled={busy} onClick={() => setEditId(null)}>Cancel</button>
            </>
          ) : (
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span className="num">
                {peso(p.amount_received)} received
                {Number(p.ewt_amount) > 0 && ` · ${peso(p.ewt_amount)} EWT`}
                {Number(p.discount_amount) > 0 && ` · ${peso(p.discount_amount)} discount`}
                {p.collection_receipt_no && ` · ${/^cr\b/i.test(p.collection_receipt_no) ? p.collection_receipt_no : `CR ${p.collection_receipt_no}`}`}
              </span>
              <span className="dim" style={{ fontSize: 12.5 }}>
                {fmtTime(p.verified_at)}{p.verified_by_name ? ` by ${p.verified_by_name}` : ""}
              </span>
              <button className="btn sm ghost" onClick={() => start(p)}>Correct</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
