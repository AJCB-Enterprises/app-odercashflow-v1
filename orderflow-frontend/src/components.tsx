import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { daysUntil } from "./api";

/* ---- Card ---- */
export function Card({ title, hint, pad = true, children }: {
  title?: string; hint?: string; pad?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="card">
      {title && (
        <div className="card-h">
          <h2>{title}</h2>
          {hint && <span className="hint">{hint}</span>}
        </div>
      )}
      {pad ? <div className="card-b">{children}</div> : children}
    </div>
  );
}

/* ---- status chips ---- */
export const InvoiceChip = ({ inv }: { inv: { status: string; due_date: string; is_overdue?: boolean } }) => {
  const overdue = inv.is_overdue ?? (inv.status === "unpaid" && daysUntil(inv.due_date) < 0);
  if (inv.status === "paid") return <span className="chip green">Paid</span>;
  if (inv.status === "receipt_uploaded") return <span className="chip blue">Receipt uploaded</span>;
  if (inv.status === "void") return <span className="chip gray">Void</span>;
  return overdue ? <span className="chip red">Overdue</span> : <span className="chip amber">Unpaid</span>;
};

export const OrderChip = ({ status }: { status: string }) =>
  status === "approved" ? <span className="chip green">Approved</span>
  : status === "rejected" ? <span className="chip red">Rejected</span>
  : status === "cancelled" ? <span className="chip gray">Cancelled</span>
  : <span className="chip amber">Pending review</span>;

/* ---- toast ---- */
const ToastCtx = createContext<(msg: string, isError?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);
  const timer = useRef<number>();
  const show = useCallback((msg: string, isError = false) => {
    setToast({ msg, err: isError });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div className={"toast" + (toast.err ? " err" : "")} role="status">{toast.msg}</div>}
    </ToastCtx.Provider>
  );
}

/* ---- data loading hook ---- */
export function useData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    load()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

export const Loading = () => <div className="empty">Loading…</div>;
export const ErrorBox = ({ msg }: { msg: string }) => <div className="errbox">{msg}</div>;
