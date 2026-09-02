import { useState } from "react";
import { api, fmtTime, peso } from "../../api";
import { Card, ErrorBox, Loading, useData, useToast } from "../../components";

export default function Receipts() {
  const { data, error, loading, reload } = useData<any[]>(() => api.get("/invoices?state=receipt_uploaded"), []);
  const toast = useToast();

  const [recording, setRecording] = useState<string | null>(null);
  const [amountReceived, setAmountReceived] = useState("");
  const [ewtAmount, setEwtAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const view = async (invoiceId: string) => {
    try {
      await api.openBlob(`/invoices/${invoiceId}/receipt`);
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

  const startRecording = (i: any) => {
    setRecording(i.id);
    setAmountReceived(String(i.balance_due));
    setEwtAmount("0");
  };

  const confirmPayment = async (invoiceId: string, invoiceNo: string) => {
    setBusy(true);
    try {
      const res = await api.post<{ fully_paid: boolean; balance_due: number }>(`/invoices/${invoiceId}/payments`, {
        amount_received: Number(amountReceived) || 0,
        ewt_amount: Number(ewtAmount) || 0,
      });
      toast(
        res.fully_paid
          ? `${invoiceNo} marked as paid.`
          : `Payment recorded for ${invoiceNo}. Remaining balance: ${peso(res.balance_due)}.`
      );
      setRecording(null);
      reload();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="page">Receipts to verify</h1>
      <p className="pagesub">
        Clients uploaded these payment receipts through their secure links. Verify against your bank
        records, enter what actually came in — including any BIR EWT withheld, per the client's Form
        2307 — then record it. An invoice only closes out once the balance reaches zero; a short
        payment stays open for the remainder and keeps sending reminders automatically.
      </p>
      {error && <ErrorBox msg={error} />}
      <Card pad={false}>
        {loading ? <Loading /> : (
          <table className="ledger">
            <thead>
              <tr><th>Invoice</th><th>Client</th><th className="right">Balance due</th><th>Receipt file</th><th>Uploaded</th><th /></tr>
            </thead>
            <tbody>
              {(data || []).map((i) => (
                <tr key={i.id}>
                  <td className="num strong">{i.invoice_no}</td>
                  <td>{i.company_name}</td>
                  <td className="num right">{peso(i.balance_due)}</td>
                  <td className="num">{i.receipt_name}</td>
                  <td className="num">{i.receipt_uploaded_at ? fmtTime(i.receipt_uploaded_at) : "—"}</td>
                  <td className="right" style={{ whiteSpace: "nowrap" }}>
                    <button className="btn sm ghost" onClick={() => view(i.id)}>View</button>{" "}
                    {i.ewt_name && (
                      <>
                        <button className="btn sm ghost" onClick={() => viewEwt(i.id)}>View 2307</button>{" "}
                      </>
                    )}
                    {recording === i.id ? (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <input className="f num" style={{ width: 100 }} type="number" min={0} step="0.01"
                          placeholder="Received" value={amountReceived}
                          onChange={(e) => setAmountReceived(e.target.value)} />
                        <input className="f num" style={{ width: 90 }} type="number" min={0} step="0.01"
                          placeholder="EWT" value={ewtAmount}
                          onChange={(e) => setEwtAmount(e.target.value)} />
                        <button className="btn sm green" disabled={busy} onClick={() => confirmPayment(i.id, i.invoice_no)}>
                          {busy ? "Saving…" : "Confirm"}
                        </button>
                        <button className="btn sm ghost" disabled={busy} onClick={() => setRecording(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="btn sm green" onClick={() => startRecording(i)}>Record payment</button>
                    )}
                  </td>
                </tr>
              ))}
              {!data?.length && <tr><td colSpan={6} className="empty">No receipts waiting for verification.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
