import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import { getUser } from "./api";
import { ToastProvider } from "./components";
import Shell from "./Shell";
import Login from "./pages/Login";
import Upload from "./pages/Upload";
import EwtUpload from "./pages/EwtUpload";
import Notifications from "./pages/Notifications";
import Account from "./pages/Account";
import Dashboard from "./pages/admin/Dashboard";
import { OrderList, OrderDetail } from "./pages/admin/Orders";
import Receipts from "./pages/admin/Receipts";
import Reminders from "./pages/admin/Reminders";
import Agents from "./pages/admin/Agents";
import Mapping from "./pages/admin/Mapping";
import { Directory, ClientDetail } from "./pages/admin/Directory";
import Announcements from "./pages/admin/Announcements";
import { AgentClients, AgentNewOrder, AgentOrders, AgentInvoices } from "./pages/agent/AgentPages";

const Home = () => {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "admin" ? "/admin/dashboard" : "/agent/clients"} replace />;
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Public: emailed secure link lands here — no login required */}
          <Route path="/u/:token" element={<Upload />} />
          <Route path="/e/:token" element={<EwtUpload />} />

          <Route element={<Shell />}>
            <Route path="/" element={<Home />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/account" element={<Account />} />
            <Route path="/admin/dashboard" element={<Dashboard />} />
            <Route path="/admin/orders" element={<OrderList />} />
            <Route path="/admin/orders/:id" element={<OrderDetail />} />
            <Route path="/admin/receipts" element={<Receipts />} />
            <Route path="/admin/reminders" element={<Reminders />} />
            <Route path="/admin/agents" element={<Agents />} />
            <Route path="/admin/mapping" element={<Mapping />} />
            <Route path="/admin/directory" element={<Directory />} />
            <Route path="/admin/directory/:id" element={<ClientDetail />} />
            <Route path="/admin/announcements" element={<Announcements />} />
            <Route path="/agent/clients" element={<AgentClients />} />
            <Route path="/agent/new-order" element={<AgentNewOrder />} />
            <Route path="/agent/orders" element={<AgentOrders />} />
            <Route path="/agent/invoices" element={<AgentInvoices />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </React.StrictMode>
);
