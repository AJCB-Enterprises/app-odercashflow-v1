import { useState } from "react";
import { api } from "../../api";
import { useToast } from "../../components";

// For reinvoicing a client under a new Sales Invoice number (including invoices
// that predate the app): renames the SI in place so the order, amount and
// payments stay attached, instead of logging the order again and voiding.
export default function EditInvoiceNo({ invoiceId, currentNo, onDone, onCancel }: {
  invoiceId: string; currentNo: string; onDone: () => void; onCancel: () => void;
}) {
  const toast = useToast();
  const [newNo, setNewNo] = useState(currentNo);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/invoices/${invoiceId}/invoice-no`, { invoice_no: newNo.trim(), reason: reason.trim() });
      toast(`Invoice ${currentNo} is now ${newNo.trim()}.`);
      onDone();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const changed = newNo.trim() !== "" && newNo.trim() !== currentNo;

  return (
    <div style={{ padding: "4px 0" }}>
      <p className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>
        Use this when the client is reinvoiced under a different Sales Invoice number. The order, amount and payments
        stay on the invoice; only the number changes, and the old number is kept in the activity log.
      </p>
      <label className="f" htmlFor={`si-${invoiceId}`}>New Sales Invoice number</label>
      <input id={`si-${invoiceId}`} className="f" style={{ maxWidth: 300 }} value={newNo} onChange={(e) => setNewNo(e.target.value)} />
      <label className="f" htmlFor={`sir-${invoiceId}`}>Reason (required)</label>
      <input id={`sir-${invoiceId}`} className="f" style={{ maxWidth: 460 }} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Reinvoiced under the new SI book" />
      <button className="btn sm" disabled={busy || !changed || reason.trim().length < 3} onClick={save}>
        {busy ? "Saving…" : "Save number"}
      </button>{" "}
      <button className="btn sm ghost" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  );
}
