import { useState } from "react";
import { api, getUser } from "../../api";
import { Card, ErrorBox, Loading, useData, useToast } from "../../components";
import { MonthNav, monthLabel, pctOf, PctChip, peso, ProgressBar, targetNote, thisMonth } from "../salesUtil";

export default function SalesPerformance() {
  const toast = useToast();
  const canSet = getUser()?.can_manage_agents !== false;
  const [month, setMonth] = useState(thisMonth());
  const { data, error, loading, reload } = useData<any>(() => api.get(`/sales/summary?month=${month}`), [month]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const save = async (agent: any) => {
    const raw = drafts[agent.agent_id];
    const amount = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(amount) || amount < 0) return toast("Enter a target of 0 or more.", true);
    setSavingId(agent.agent_id);
    try {
      await api.put("/sales/targets", { agent_id: agent.agent_id, month, target_amount: amount });
      toast(
        amount > 0
          ? `${agent.full_name}'s target is ${peso(amount)} from ${monthLabel(month)} onward, until changed.`
          : `${agent.full_name}'s target is cleared from ${monthLabel(month)} onward.`
      );
      setDrafts(({ [agent.agent_id]: _, ...rest }) => rest);
      reload();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setSavingId(null);
    }
  };

  const agents: any[] = data?.agents || [];
  const totalTarget = agents.reduce((s, a) => s + Number(a.target || 0), 0);
  const totalAchieved = agents.reduce((s, a) => s + Number(a.achieved), 0);
  const targeted = agents.filter((a) => a.target);
  const targetedAchieved = targeted.reduce((s, a) => s + Number(a.achieved), 0);

  return (
    <>
      <h1 className="page">Sales performance</h1>
      <p className="pagesub">
        Each agent's approved orders for the month against their target.
        {canSet && " A target you set applies from that month onward until you change it — enter 0 to clear it."}
      </p>
      <MonthNav month={month} onChange={setMonth} />
      {error && <ErrorBox msg={error} />}
      <Card title={monthLabel(month)} hint={`${agents.length} agent(s)`} pad={false}>
        {loading ? <Loading /> : (
          <table className="ledger">
            <thead>
              <tr><th>Agent</th><th className="right">Target</th><th className="right">Achieved</th><th>Progress</th><th className="right">Pending review</th></tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const pct = pctOf(Number(a.achieved), a.target ? Number(a.target) : null);
                const draft = drafts[a.agent_id];
                const note = targetNote(month, a.target_from);
                return (
                  <tr key={a.agent_id}>
                    <td className="strong">
                      {a.full_name}
                      {!a.is_active && <span className="chip amber" style={{ marginLeft: 8 }}>Inactive</span>}
                      <div className="dim" style={{ fontSize: 12.5 }}>{a.approved_count} approved order(s)</div>
                    </td>
                    <td className="right">
                      {canSet ? (
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                          <input className="f num" style={{ width: 130, marginBottom: 0 }} type="number" min={0} step="1"
                            aria-label={`Target for ${a.full_name}`} placeholder="No target"
                            value={draft ?? (a.target ? String(Number(a.target)) : "")}
                            onChange={(e) => setDrafts({ ...drafts, [a.agent_id]: e.target.value })} />
                          {draft !== undefined && (
                            <button className="btn sm" disabled={savingId === a.agent_id} onClick={() => save(a)}>
                              {savingId === a.agent_id ? "Saving…" : "Save"}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="num">{a.target ? peso(a.target) : <span className="dim">—</span>}</span>
                      )}
                      {note && draft === undefined && <div className="dim" style={{ fontSize: 12 }}>{note}</div>}
                    </td>
                    <td className="num right">{peso(a.achieved)}</td>
                    <td style={{ minWidth: 150 }}>
                      {pct !== null ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1 }}><ProgressBar pct={pct} /></div>
                          <PctChip pct={pct} />
                        </div>
                      ) : <span className="dim">No target</span>}
                    </td>
                    <td className="num right">
                      {a.pending_count > 0 ? `${peso(a.pending_amount)} (${a.pending_count})` : <span className="dim">—</span>}
                    </td>
                  </tr>
                );
              })}
              {!agents.length && <tr><td colSpan={5} className="empty">No agents yet.</td></tr>}
              {agents.length > 0 && (
                <tr>
                  <td className="strong">Team total</td>
                  <td className="num right strong">{totalTarget > 0 ? peso(totalTarget) : "—"}</td>
                  <td className="num right strong">{peso(totalAchieved)}</td>
                  <td>
                    {totalTarget > 0 && (
                      <span className="dim" style={{ fontSize: 12.5 }}>
                        {pctOf(targetedAchieved, totalTarget)}% of the team target
                      </span>
                    )}
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
