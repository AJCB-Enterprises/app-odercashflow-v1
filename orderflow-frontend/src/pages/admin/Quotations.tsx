import { api, fmtDate, peso } from "../../api";
import { Card, ErrorBox, Loading, PAYMENT_TERM_OPTIONS, useData, VAT_STATUS_OPTIONS } from "../../components";

export default function Quotations() {
  const { data, error, loading } = useData<any[]>(() => api.get("/quotations"), []);

  return (
    <>
      <h1 className="page">Quotations</h1>
      <p className="pagesub">Price quotations agents have sent to clients — for reference only, no action needed here.</p>
      {error && <ErrorBox msg={error} />}
      <Card pad={false}>
        {loading ? <Loading /> : (
          <table className="ledger">
            <thead>
              <tr><th>Quote #</th><th>Client</th><th>Agent</th><th className="right">Total</th><th>Terms</th><th>Valid until</th><th>Sent</th></tr>
            </thead>
            <tbody>
              {(data || []).map((qt) => (
                <tr key={qt.id}>
                  <td className="num strong">
                    {qt.quote_no}
                    <div className="dim" style={{ fontSize: 12.5 }}>
                      {(qt.items || []).map((it: any) => it.description).join(", ")}
                    </div>
                  </td>
                  <td>{qt.company_name}</td>
                  <td>{qt.agent_name || <span className="dim">—</span>}</td>
                  <td className="num right">{peso(qt.total)}</td>
                  <td>
                    {PAYMENT_TERM_OPTIONS.find((o) => o.value === qt.payment_terms)?.label || qt.payment_terms}
                    <div className="dim" style={{ fontSize: 12.5 }}>
                      {VAT_STATUS_OPTIONS.find((o) => o.value === qt.vat_status)?.label || qt.vat_status}
                    </div>
                  </td>
                  <td className="num">{fmtDate(qt.valid_until)}</td>
                  <td>{qt.sent_at ? <span className="chip green">Sent</span> : <span className="chip amber">Not sent</span>}</td>
                </tr>
              ))}
              {!data?.length && <tr><td colSpan={7} className="empty">No quotations yet.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
