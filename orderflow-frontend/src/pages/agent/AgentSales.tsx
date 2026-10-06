import { useState } from "react";
import { api, fmtDate, getUser } from "../../api";
import { Card, ErrorBox, Loading, OrderChip, useData } from "../../components";
import { MonthNav, monthLabel, pctOf, PctChip, peso, ProgressBar, targetNote, thisMonth } from "../salesUtil";

export default function AgentSales() {
  const me = getUser();
  const [month, setMonth] = useState(thisMonth());
  const { data, error, loading } = useData<any>(() => api.get(`/sales/agent/${me?.id}?month=${month}`), [month]);

  if (error) return <ErrorBox msg={error} />;
  const s = data?.summary;
  const achieved = Number(s?.achieved || 0);
  const target = s?.target ? Number(s.target) : null;
  const pct = pctOf(achieved, target);
  const remaining = target !== null ? target - achieved : null;
  const note = s ? targetNote(month, s.target_from) : null;

  return (
    <>
      <h1 className="page">Sales performance</h1>
      <p className="pagesub">
        Your approved orders for the month against your target. Orders still awaiting review are shown but
        only count toward your total once approved.
      </p>
      <MonthNav month={month} onChange={setMonth} />
      {loading || !s ? <Loading /> : (
        <>
          <Card title={monthLabel(month)} hint={target !== null ? `${pct}% of target` : "no target set"}>
            <div className="metrics">
              <div className="metric"><div className="mlbl">Target</div><div className="mval">{target !== null ? peso(target) : "—"}</div></div>
              <div className="metric"><div className="mlbl">Achieved</div><div className="mval">{peso(achieved)}</div></div>
              {remaining !== null && (
                <div className="metric">
                  <div className="mlbl">{remaining > 0 ? "Remaining" : "Over target by"}</div>
                  <div className="mval">{peso(Math.abs(remaining))}</div>
                </div>
              )}
            </div>
            {pct !== null && <ProgressBar pct={pct} />}
            {target === null && (
              <p className="dim" style={{ marginTop: 6 }}>No target has been set for this month — ask your admin to set one.</p>
            )}
            {note && <p className="dim" style={{ marginTop: 8, fontSize: 12.5 }}>{note}</p>}
            {s.pending_count > 0 && (
              <p className="dim" style={{ marginTop: 8, fontSize: 12.5 }}>
                Plus {peso(s.pending_amount)} across {s.pending_count} order(s) pending review — counted once approved.
              </p>
            )}
          </Card>

          <Card title={`Orders logged in ${monthLabel(month)}`} hint={`${s.approved_count} approved`} pad={false}>
            <table className="ledger">
              <thead><tr><th>Order</th><th>Client</th><th className="right">Total</th><th>Logged</th><th>Status</th></tr></thead>
              <tbody>
                {data.orders.map((o: any) => (
                  <tr key={o.id}>
                    <td className="num strong">
                      {o.order_no}
                      {o.logged_by_admin && <div className="dim" style={{ fontSize: 12 }}>logged by admin</div>}
                    </td>
                    <td>{o.company_name}</td>
                    <td className="num right">{peso(o.total)}</td>
                    <td className="num">{fmtDate(o.created_at)}</td>
                    <td><OrderChip status={o.status} /></td>
                  </tr>
                ))}
                {!data.orders.length && <tr><td colSpan={5} className="empty">No orders logged this month.</td></tr>}
              </tbody>
            </table>
          </Card>

          <Card title="Last 6 months" pad={false}>
            <table className="ledger">
              <thead><tr><th>Month</th><th className="right">Target</th><th className="right">Achieved</th><th className="right">% of target</th></tr></thead>
              <tbody>
                {data.history.map((h: any) => (
                  <tr key={h.month} className="rowbtn" onClick={() => setMonth(h.month)}>
                    <td>{monthLabel(h.month)}</td>
                    <td className="num right">{h.target ? peso(h.target) : <span className="dim">—</span>}</td>
                    <td className="num right">{peso(h.achieved)}</td>
                    <td className="right"><PctChip pct={pctOf(Number(h.achieved), h.target ? Number(h.target) : null)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
