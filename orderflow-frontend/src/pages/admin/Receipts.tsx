import { api, fmtTime, peso } from "../../api";
import { Card, ErrorBox, Loading, useData, useToast } from "../../components";

export default function Receipts() {
  const { data, error, loading, reload } = useData<any[]>(() => api.get("/invoices?state=receipt_uploaded"), []);
  const toast = useToast();

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

  const markPaid = async (invoiceId: string, invoiceNo: string) => {
    try {
      await api.post(`/invoices/${invoiceId}/mark-paid`);
      toast(`${invoiceNo} marked as paid.`);
      reload();
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  return (
    <>
      <h1 className="page">Receipts to verify</h1>
      <p className="pagesub">
        Clients uploaded these payment receipts through their secure links. Verify against your
        bank records, then mark paid — marking paid also revokes the invoice's upload links.
      </p>
      {error && <ErrorBox msg={error} />}
      <Card pad={false}>
        {loading ? <Loading /> : (
          <table className="ledger">
            <thead>
              <tr><th>Invoice</th><th>Client</th><th className="right">Amount</th><th>Receipt file</th><th>Uploaded</th><th /></tr>
            </thead>
            <tbody>
              {(data || []).map((i) => (
                <tr key={i.id}>
                  <td className="num strong">{i.invoice_no}</td>
                  <td>{i.company_name}</td>
                  <td className="num right">{peso(i.amount)}</td>
                  <td className="num">{i.receipt_name}</td>
                  <td className="num">{i.receipt_uploaded_at ? fmtTime(i.receipt_uploaded_at) : "—"}</td>
                  <td className="right" style={{ whiteSpace: "nowrap" }}>
                    <button className="btn sm ghost" onClick={() => view(i.id)}>View</button>{" "}
                    {i.ewt_name && (
                      <>
                        <button className="btn sm ghost" onClick={() => viewEwt(i.id)}>View 2307</button>{" "}
                      </>
                    )}
                    <button className="btn sm green" onClick={() => markPaid(i.id, i.invoice_no)}>Mark paid</button>
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
