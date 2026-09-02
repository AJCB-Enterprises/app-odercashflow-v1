import { api, fmtDate, peso } from "../../api";
import { Card, ErrorBox, InvoiceChip, Loading, useData } from "../../components";

export default function Dashboard() {
  const { data, error, loading } = useData<any>(() => api.get("/dashboard/payments-due"), []);

  return (
    <>
      <h1 className="page">Payment-due dashboard</h1>
      <p className="pagesub">Customers with payments coming due or already overdue.</p>
      {error && <ErrorBox msg={error} />}
      {loading ? <Loading /> : data && (
        <>
          <div className="statgrid">
            <div className="stat"><div className="k">Overdue</div><div className="v red">{data.summary.overdue_count}</div></div>
            <div className="stat"><div className="k">Due within {data.summary.due_soon_window_days} days</div><div className="v amber">{data.summary.due_soon_count}</div></div>
            <div className="stat"><div className="k">Outstanding total</div><div className="v">{peso(data.summary.outstanding_total)}</div></div>
            <div className="stat"><div className="k">Receipts to verify</div><div className="v green">{data.summary.receipts_to_verify}</div></div>
          </div>
          <Card title="Open invoices" hint="soonest due first" pad={false}>
            <table className="ledger">
              <thead>
                <tr><th>Invoice</th><th>Client</th><th className="right">Balance due</th><th>Due</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.invoices.map((i: any) => (
                  <tr key={i.id}>
                    <td className="num strong">{i.invoice_no}</td>
                    <td>{i.company_name}<div className="dim">{i.contact_name}</div></td>
                    <td className="num right">{peso(i.balance_due)}</td>
                    <td className="num">
                      {fmtDate(i.due_date)}
                      <div className="dim" style={i.is_overdue ? { color: "var(--red)" } : undefined}>
                        {i.is_overdue
                          ? `${-i.days_until_due} days overdue`
                          : i.days_until_due === 0 ? "due today" : `in ${i.days_until_due} days`}
                      </div>
                    </td>
                    <td><InvoiceChip inv={i} /></td>
                  </tr>
                ))}
                {!data.invoices.length && <tr><td colSpan={5} className="empty">Nothing outstanding. All invoices are settled.</td></tr>}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
