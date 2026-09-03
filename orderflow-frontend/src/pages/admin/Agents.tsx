import { useState } from "react";
import { api, getUser } from "../../api";
import { Card, ErrorBox, Loading, useData, useToast } from "../../components";

export default function Agents() {
  const { data, error, loading, reload } = useData<any[]>(() => api.get("/agents"), []);
  const { data: admins, error: adminsError, loading: adminsLoading, reload: reloadAdmins } = useData<any[]>(
    () => api.get("/agents/admins"),
    []
  );
  const me = getUser();
  const toast = useToast();
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });
  const [adminForm, setAdminForm] = useState({
    full_name: "",
    email: "",
    password: "",
    can_manage_agents: true,
    can_manage_announcements: true,
  });

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

  const createAdmin = async () => {
    try {
      await api.post("/agents/admins", adminForm);
      toast(`Admin account created for ${adminForm.full_name}.`);
      setAdminForm({ full_name: "", email: "", password: "", can_manage_agents: true, can_manage_announcements: true });
      reloadAdmins();
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const patchAdmin = async (id: string, body: object) => {
    try {
      await api.patch(`/agents/admins/${id}`, body);
      reloadAdmins();
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

      <Card title="Create admin account" hint="optionally restricted — uncheck what this admin shouldn't access">
        {adminsError && <ErrorBox msg={adminsError} />}
        <div className="grid2">
          <div>
            <label className="f" htmlFor="adn">Full name</label>
            <input id="adn" className="f" value={adminForm.full_name}
              onChange={(e) => setAdminForm({ ...adminForm, full_name: e.target.value })} placeholder="e.g. AR Davao" />
          </div>
          <div>
            <label className="f" htmlFor="ade">Email</label>
            <input id="ade" className="f" type="email" value={adminForm.email}
              onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} placeholder="name@ajcb.com.ph" />
          </div>
          <div>
            <label className="f" htmlFor="adp">Temporary password (min 10 chars)</label>
            <input id="adp" className="f" type="password" value={adminForm.password}
              onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })} />
          </div>
        </div>
        <label style={{ display: "block", cursor: "pointer", marginTop: 10 }}>
          <input type="checkbox" checked={adminForm.can_manage_agents}
            onChange={(e) => setAdminForm({ ...adminForm, can_manage_agents: e.target.checked })} /> Manage agent accounts
        </label>
        <label style={{ display: "block", cursor: "pointer" }}>
          <input type="checkbox" checked={adminForm.can_manage_announcements}
            onChange={(e) => setAdminForm({ ...adminForm, can_manage_announcements: e.target.checked })} /> Manage announcements
        </label>
        <button className="btn" style={{ marginTop: 14 }} onClick={createAdmin}
          disabled={!adminForm.full_name || !adminForm.email || adminForm.password.length < 10}>
          Create account
        </button>
      </Card>

      <Card title="All admin accounts" pad={false}>
        {adminsLoading ? <Loading /> : (
          <table className="ledger">
            <thead><tr><th>Admin</th><th>Email</th><th>Permissions</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(admins || []).map((a) => {
                const isSelf = a.id === me?.id;
                return (
                  <tr key={a.id}>
                    <td className="strong">{a.full_name}{isSelf && <span className="dim"> (you)</span>}</td>
                    <td className="num">{a.email}</td>
                    <td>
                      <label style={{ display: "block", cursor: isSelf ? "default" : "pointer" }}>
                        <input type="checkbox" checked={a.can_manage_agents} disabled={isSelf}
                          onChange={() => patchAdmin(a.id, { can_manage_agents: !a.can_manage_agents })} /> Manage agent accounts
                      </label>
                      <label style={{ display: "block", cursor: isSelf ? "default" : "pointer" }}>
                        <input type="checkbox" checked={a.can_manage_announcements} disabled={isSelf}
                          onChange={() => patchAdmin(a.id, { can_manage_announcements: !a.can_manage_announcements })} /> Manage announcements
                      </label>
                    </td>
                    <td>{a.is_active ? <span className="chip green">Active</span> : <span className="chip gray">Deactivated</span>}</td>
                    <td className="right">
                      {!isSelf && (
                        <button className="btn sm ghost" onClick={() => patchAdmin(a.id, { is_active: !a.is_active })}>
                          {a.is_active ? "Deactivate" : "Reactivate"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!admins?.length && <tr><td colSpan={5} className="empty">No admin accounts yet.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
