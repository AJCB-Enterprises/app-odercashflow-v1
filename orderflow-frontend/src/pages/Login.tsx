import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setSession } from "../api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ token: string; user: any }>("/auth/login", { email, password }, false);
      setSession(res.token, res.user);
      navigate(res.user.role === "admin" ? "/admin/dashboard" : "/agent/clients");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="loginwrap">
      <div className="brand" style={{ color: "var(--ink)", marginBottom: 24 }}>
        OrderFlow
        <small style={{ color: "var(--muted)" }}>orders · invoices · reminders</small>
      </div>
      <div className="card">
        <div className="card-b">
          <form onSubmit={submit}>
            <label className="f" htmlFor="email">Email</label>
            <input id="email" className="f" type="email" autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} required />
            <label className="f" htmlFor="password">Password</label>
            <input id="password" className="f" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
            {error && <div className="errbox">{error}</div>}
            <button className="btn" style={{ marginTop: 16, width: "100%" }} disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
      <p className="dim" style={{ fontSize: 12.5 }}>
        Staff sign-in for admins and agents. Clients don't need an account — payment
        upload links arrive by email.
      </p>
    </div>
  );
}
