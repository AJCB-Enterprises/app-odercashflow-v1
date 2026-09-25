import { useState } from "react";
import { api, fmtDate, peso } from "../../api";
import { Card, ErrorBox, InvoiceChip, Loading, useData } from "../../components";

type FilterKey = "overdue" | "due_soon" | "receipts" | "no_email" | "manual_collection" | "missing_2307";

/** EWT was actually withheld on a payment against this invoice, but no BIR Form 2307 is on file yet. */
const missing2307 = (i: any) => Number(i.total_ewt) > 0 && !i.ewt_name;

/** Mirrors the exact predicates dashboard.ts used to compute each summary count. */
const matchesFilter = (i: any, key: FilterKey | null, dueSoonWindowDays: number): boolean => {
  switch (key) {
    case "overdue": return i.is_overdue;
    case "due_soon": return !i.is_overdue && i.status === "unpaid" && i.days_until_due <= dueSoonWindowDays;
    case "receipts": return i.status === "receipt_uploaded";
    case "no_email": return !i.has_email;
    case "manual_collection": return i.collects_in_person;
    case "missing_2307": return missing2307(i);
    default: return true;
  }
};

export default function Dashboard() {
  const { data, error, loading } = useData<any>(() => api.get("/dashboard/payments-due"), []);
  const [filter, setFilter] = useState<FilterKey | null>(null);
  const toggle = (key: FilterKey) => setFilter((f) => (f === key ? null : key));

  const FILTER_LABELS: Record<FilterKey, string> = {
    overdue: "Overdue",
    due_soon: `Due within ${data?.summary.due_soon_window_days ?? ""} days`,
    receipts: "Receipts to verify",
    no_email: "Needs manual reminder",
    manual_collection: "Check/in-person collection",
    missing_2307: "Lacking 2307",
  };

  const filteredInvoices = data ? data.invoices.filter((i: any) => matchesFilter(i, filter, data.summary.due_soon_window_days)) : [];
  const statClass = (key: FilterKey | null) => `stat clickable${filter === key ? " active" : ""}`;

  return (
    <>
      <h1 className="page">Payment-due dashboard</h1>
      <p className="pagesub">Customers with payments coming due or already overdue. Click a box to filter the list below.</p>
      {error && <ErrorBox msg={error} />}
      {loading ? <Loading /> : data && (
        <>
          <div className="statgrid">
            <div className={statClass("overdue")} onClick={() => toggle("overdue")}>
              <div className="k">Overdue</div><div className="v red">{data.summary.overdue_count}</div>
            </div>
            <div className={statClass("due_soon")} onClick={() => toggle("due_soon")}>
              <div className="k">Due within {data.summary.due_soon_window_days} days</div><div className="v amber">{data.summary.due_soon_count}</div>
            </div>
            <div className={statClass(null)} onClick={() => setFilter(null)} title="Show every open invoice">
              <div className="k">Outstanding total</div><div className="v">{peso(data.summary.outstanding_total)}</div>
            </div>
            <div className={statClass("receipts")} onClick={() => toggle("receipts")}>
              <div className="k">Receipts to verify</div><div className="v green">{data.summary.receipts_to_verify}</div>
            </div>
            <div className={statClass("no_email")} onClick={() => toggle("no_email")}>
              <div className="k">Needs manual reminder</div><div className="v amber">{data.summary.no_email_count}</div>
            </div>
            <div className={statClass("manual_collection")} onClick={() => toggle("manual_collection")}>
              <div className="k">Check/in-person collection</div><div className="v amber">{data.summary.manual_collection_count}</div>
            </div>
            <div className={statClass("missing_2307")} onClick={() => toggle("missing_2307")}>
              <div className="k">Lacking 2307</div><div className="v amber">{data.summary.missing_2307_count}</div>
            </div>
          </div>
          <Card
            title={filter ? `Open invoices — ${FILTER_LABELS[filter]}` : "Open invoices"}
            hint={filter ? `${filteredInvoices.length} shown — click the box again, or "Outstanding total," to clear` : "soonest due first"}
            pad={false}
          >
            <table className="ledger">
              <thead>
                <tr><th>Invoice</th><th>Client</th><th className="right">Balance due</th><th>Due</th><th>Status</th></tr>
              </thead>
              <tbody>
                {filteredInvoices.map((i: any) => (
                  <tr key={i.id}>
                    <td className="num strong">{i.invoice_no}</td>
                    <td>
                      {i.company_name}
                      {!i.has_email && <span className="chip amber" style={{ marginLeft: 8 }}>No email</span>}
                      {i.collects_in_person && <span className="chip amber" style={{ marginLeft: 8 }}>Check/in-person</span>}
                      {missing2307(i) && <span className="chip orange" style={{ marginLeft: 8 }}>No 2307</span>}
                      <div className="dim">{i.contact_name}</div>
                    </td>
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
                {!filteredInvoices.length && (
                  <tr><td colSpan={5} className="empty">{filter ? "No invoices match this filter." : "Nothing outstanding. All invoices are settled."}</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
