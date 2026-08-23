import { api, fmtTime } from "../api";
import { Card, ErrorBox, Loading, useData, useToast } from "../components";

export default function Notifications() {
  const { data, error, loading, reload } = useData<any[]>(() => api.get("/notifications"), []);
  const toast = useToast();

  const markAll = async () => {
    await api.post("/notifications/read-all");
    toast("All notifications marked read.");
    reload();
  };

  return (
    <>
      <h1 className="page">Notifications</h1>
      <p className="pagesub">In-app alerts — new orders, uploaded receipts, approvals, and reminder runs.</p>
      {error && <ErrorBox msg={error} />}
      {data?.some((n) => !n.read_at) && (
        <button className="btn sm ghost" style={{ marginBottom: 12 }} onClick={markAll}>Mark all read</button>
      )}
      <Card pad={false}>
        {loading ? <Loading /> : (
          <>
            {(data || []).map((n) => (
              <div className="notif" key={n.id}>
                <span className={"dot" + (n.read_at ? " read" : "")} />
                <div>
                  {n.body}
                  <div className="dim num" style={{ fontSize: 11.5 }}>{fmtTime(n.created_at)}</div>
                </div>
              </div>
            ))}
            {!data?.length && <div className="empty">No notifications yet.</div>}
          </>
        )}
      </Card>
    </>
  );
}
