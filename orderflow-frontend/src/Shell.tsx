import { Link, NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { api, clearSession, getToken, getUser } from "./api";
import { useData } from "./components";

const NavItem = ({ to, label, badge }: { to: string; label: string; badge?: number }) => (
  <NavLink to={to} className={({ isActive }) => "navbtn" + (isActive ? " on" : "")}>
    {label}
    {badge ? <span className="count">{badge}</span> : null}
  </NavLink>
);

export default function Shell() {
  const user = getUser();
  const navigate = useNavigate();
  const { data: notifs } = useData<any[]>(() => api.get("/notifications"), []);
  const unread = (notifs || []).filter((n) => !n.read_at).length;

  if (!getToken() || !user) return <Navigate to="/login" replace />;

  const logout = () => {
    clearSession();
    navigate("/login");
  };

  return (
    <>
      <div className="topbar">
        <Link to="/" className="brand">
          OrderFlow
          <small>orders · invoices · reminders</small>
        </Link>
        <div className="whoami">
          <span className="rolechip">{user.role}</span>
          <Link to="/account" className="name" style={{ textDecoration: "underline" }}>{user.full_name}</Link>
          <button className="btn sm ghost" style={{ borderColor: "#4A4F5C", color: "#C9CCD5" }} onClick={logout}>
            Sign out
          </button>
        </div>
      </div>
      <div className="shell">
        <nav className="sidenav">
          {user.role === "admin" ? (
            <>
              <div className="navlabel">Admin console</div>
              <NavItem to="/admin/dashboard" label="Payment-due dashboard" />
              <NavItem to="/admin/orders" label="Order review" />
              <NavItem to="/admin/receipts" label="Receipts to verify" />
              <NavItem to="/admin/reminders" label="Reminder scheduling" />
              <NavItem to="/admin/agents" label="Agent accounts" />
              <NavItem to="/admin/mapping" label="Agent–client mapping" />
              <NavItem to="/admin/directory" label="Customer directory" />
              <NavItem to="/admin/announcements" label="Announcements" />
              <NavItem to="/notifications" label="Notifications" badge={unread} />
            </>
          ) : (
            <>
              <div className="navlabel">Agent · {user.full_name}</div>
              <NavItem to="/agent/clients" label="My assigned clients" />
              <NavItem to="/agent/new-order" label="New sales order" />
              <NavItem to="/agent/orders" label="Orders by client" />
              <NavItem to="/agent/invoices" label="Client past invoices" />
              <NavItem to="/notifications" label="Notifications" badge={unread} />
            </>
          )}
        </nav>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </>
  );
}
