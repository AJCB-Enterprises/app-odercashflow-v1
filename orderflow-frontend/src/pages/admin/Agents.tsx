import { useState } from "react";
import { api } from "../../api";
import { Card, ErrorBox, Loading, useData, useToast } from "../../components";

export default function Agents() {
  const { data, error, loading, reload } = useData<any[]>(() => api.get("/agents"), []);
  const toast = useToast();
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });

  const create = async () => {
    try {
      await api.post("/agents", form);
      toast(`Agent account created for ${form.full_name}.`);
      setForm({ full_name: "", email: "", password: "" });
      reload();
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const patch = async (id: string, body: object) => {
    try {
      await api.patch(`/agents/${id}`, body);
      reload();
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  return (
    <>
      <h1 className="page">Agent accounts</h1>
      <p className="pagesub">Create agent user accounts and manage their access and permissions.</p>
      {error && <ErrorBox msg={error} />}

      <Card title="Create agent account">
        <div className="grid2">
          <div>
            <label className="f" htmlFor="an">Full name</label>
            <input id="an" className="f" value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="e.g. Paolo Reyes" />
          </div>
          <div>
            <label className="f" htmlFor="ae">Email</label>
            <input id="ae" className="f" type="email" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@orderflow.ph" />
          </div>
          <div>
            <label className="f" htmlFor="ap">Temporary password (min 10 chars)</label>
            <input id="ap" className="f" type="password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
        </div>
        <button className="btn" style={{ marginTop: 14 }} onClick={create}
          disabled={!form.full_name || !form.email || form.password.length < 10}>
          Create account
        </button>
      </Card>

      <Card title="All agents" pad={false}>
        {loading ? <Loading /> : (
          <table className="ledger">
            <thead><tr><th>Agent</th><th>Email</th><th>Clients</th><th>Permissions</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(data || []).map((a) => (
                <tr key={a.id}>
                  <td className="strong">{a.full_name}</td>
                  <td className="num">{a.email}</td>
                  <td className="num">{a.client_count}</td>
                  <td>
                    <label style={{ display: "block", cursor: "pointer" }}>
                      <input type="checkbox" checked={a.can_create_po}
                        onChange={() => patch(a.id, { can_create_po: !a.can_create_po })} /> Create sales orders
                    </label>
                    <label style={{ display: "block", cursor: "pointer" }}>
                      <input type="checkbox" checked={a.can_view_invoices}
                        onChange={() => patch(a.id, { can_view_invoices: !a.can_view_invoices })} /> View client invoices
                    </label>
                  </td>
                  <td>{a.is_active ? <span className="chip green">Active</span> : <span className="chip gray">Deactivated</span>}</td>
                  <td className="right">
                    <button className="btn sm ghost" onClick={() => patch(a.id, { is_active: !a.is_active })}>
                      {a.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
              {!data?.length && <tr><td colSpan={6} className="empty">No agent accounts yet.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
