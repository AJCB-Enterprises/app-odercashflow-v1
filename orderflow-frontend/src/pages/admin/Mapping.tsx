import { api, fmtDate } from "../../api";
import { Card, ErrorBox, Loading, useData, useToast } from "../../components";

function AgentGroup({ agent, agents, onChanged }: { agent: any; agents: any[]; onChanged: () => void }) {
  const { data, loading, reload } = useData<any[]>(() => api.get(`/agents/${agent.id}/clients`), [agent.id]);
  const toast = useToast();

  const reassign = async (clientId: string, agentId: string) => {
    try {
      await api.patch(`/clients/${clientId}`, { agent_id: agentId });
      toast("Client reassigned.");
      reload();
      onChanged();
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  return (
    <Card title={agent.full_name} hint={`${agent.client_count} client(s) · ${agent.is_active ? "active" : "deactivated"}`} pad={false}>
      {loading ? <Loading /> : (
        <table className="ledger">
          <thead><tr><th>Client</th><th>Orders</th><th>Latest order</th><th>Assigned agent</th></tr></thead>
          <tbody>
            {(data || []).map((c) => (
              <tr key={c.id}>
                <td className="strong">{c.company_name}<div className="dim">{c.contact_name}</div></td>
                <td className="num">{c.order_count}</td>
                <td className="num">{c.latest_order_at ? fmtDate(c.latest_order_at) : <span className="dim">No orders yet</span>}</td>
                <td>
                  <select className="f" style={{ maxWidth: 180 }} value={agent.id}
                    onChange={(e) => reassign(c.id, e.target.value)} aria-label={`Reassign ${c.company_name}`}>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={4} className="empty">No clients assigned.</td></tr>}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export default function Mapping() {
  const { data, error, loading, reload } = useData<any[]>(() => api.get("/agents"), []);

  return (
    <>
      <h1 className="page">Agent–client mapping</h1>
      <p className="pagesub">All clients grouped under each agent — drill into their orders, and reassign coverage.</p>
      {error && <ErrorBox msg={error} />}
      {loading ? <Loading /> : (data || []).map((a) => (
        <AgentGroup key={a.id} agent={a} agents={data || []} onChanged={reload} />
      ))}
    </>
  );
}
