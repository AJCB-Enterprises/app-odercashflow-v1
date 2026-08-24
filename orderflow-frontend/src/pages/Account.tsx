import { useState } from "react";
import { api, getUser } from "../api";
import { Card, useToast } from "../components";

export default function Account() {
  const user = getUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const valid = current && next.length >= 10 && next === confirm;

  const submit = async () => {
    setBusy(true);
    try {
      await api.patch("/auth/password", { current_password: current, new_password: next });
      toast("Password changed.");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="page">My account</h1>
      <p className="pagesub">{user?.full_name} · {user?.role}</p>

      <Card title="Change password">
        <label className="f" htmlFor="cp-cur">Current password</label>
        <input id="cp-cur" className="f" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <label className="f" htmlFor="cp-new">New password</label>
        <input id="cp-new" className="f" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        <label className="f" htmlFor="cp-confirm">Confirm new password</label>
        <input id="cp-confirm" className="f" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {next && next.length < 10 && <p className="dim" style={{ marginTop: 6 }}>Must be at least 10 characters.</p>}
        {confirm && next !== confirm && <p className="dim" style={{ marginTop: 6 }}>Passwords don't match.</p>}
        <button className="btn" disabled={!valid || busy} onClick={submit} style={{ marginTop: 12 }}>
          {busy ? "Changing…" : "Change password"}
        </button>
      </Card>
    </>
  );
}
