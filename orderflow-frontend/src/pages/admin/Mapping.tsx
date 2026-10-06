import { useEffect, useState } from "react";
import { api, fmtDate } from "../../api";
import { Card, ErrorBox, Loading, matchesSearch, SearchBox, useData, useToast } from "../../components";

function AgentGroup({ agent, agents, search, onChanged, onVisible }: {
  agent: any; agents: any[]; search: string; onChanged: () => void; onVisible: (agentId: string, visible: boolean) => void;
}) {
  const { data, loading, reload } = useData<any[]>(() => api.get(`/agents/${agent.id}/clients`), [agent.id]);
  const toast = useToast();

  // Searching an agent's name shows all their clients; otherwise only the matching clients,
  // and an agent with neither is hidden.
  const agentMatches = matchesSearch(search, agent.full_name);
  const clients = (data || []).filter((c) => agentMatches || matchesSearch(search, c.company_name, c.contact_name));
  const visible = !search.trim() || agentMatches || clients.length > 0;
  useEffect(() => { if (!loading) onVisible(agent.id, visible); }, [loading, visible, agent.id]);

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

  if (!visible) return null;
  return (
    <Card title={agent.full_name} hint={`${agent.client_count} client(s) · ${agent.is_active ? "active" : "deactivated"}`} pad={false}>
      {loading ? <Loading /> : (
        <table className="ledger">
          <thead><tr><th>Client</th><th>Orders</th><th>Latest order</th><th>Assigned agent</th></tr></thead>
          <tbody>
            {clients.map((c) => (
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
  const [search, setSearch] = useState("");
  const [visibleGroups, setVisibleGroups] = useState<Record<string, boolean>>({});
  const reported = Object.keys(visibleGroups).length;
  const nothingMatches = search.trim() !== "" && reported > 0 && reported === (data || []).length && !Object.values(visibleGroups).some(Boolean);

  return (
    <>
      <h1 className="page">Agent–client mapping</h1>
      <p className="pagesub">All clients grouped under each agent — drill into their orders, and reassign coverage.</p>
      <SearchBox value={search} onChange={setSearch} label="Search agents and clients"
        placeholder="Search by agent, client, or contact name…" />
      {error && <ErrorBox msg={error} />}
      {loading ? <Loading /> : (data || []).map((a) => (
        <AgentGroup key={a.id} agent={a} agents={data || []} search={search} onChanged={reload}
          onVisible={(id, v) => setVisibleGroups((g) => (g[id] === v ? g : { ...g, [id]: v }))} />
      ))}
      {nothingMatches && <div className="empty">No agent or client matches your search.</div>}
    </>
  );
}
