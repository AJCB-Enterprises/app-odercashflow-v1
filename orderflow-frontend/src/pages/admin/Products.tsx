import { useState } from "react";
import { api, peso } from "../../api";
import { Card, ErrorBox, Loading, useData, useToast } from "../../components";

export default function Products() {
  const { data, error, loading, reload } = useData<any[]>(() => api.get("/products"), []);
  const toast = useToast();

  const [description, setDescription] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [busy, setBusy] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editUnitPrice, setEditUnitPrice] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; updated: number; skipped: { line: number; reason: string }[] } | null>(null);

  const add = async () => {
    setBusy(true);
    try {
      await api.post("/products", { description: description.trim(), unit_price: Number(unitPrice) });
      toast(`${description.trim()} added to the price list.`);
      setDescription("");
      setUnitPrice("");
      reload();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (p: any) => {
    setEditId(p.id);
    setEditDescription(p.description);
    setEditUnitPrice(String(p.unit_price));
  };

  const saveEdit = async () => {
    if (!editId) return;
    setEditBusy(true);
    try {
      await api.patch(`/products/${editId}`, { description: editDescription.trim(), unit_price: Number(editUnitPrice) });
      toast("Product updated.");
      setEditId(null);
      reload();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setEditBusy(false);
    }
  };

  const importCsv = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.postForm<{ imported: number; updated: number; skipped: { line: number; reason: string }[] }>("/products/import", form);
      setImportResult(res);
      toast(
        res.skipped.length
          ? `Imported ${res.imported}, updated ${res.updated}, skipped ${res.skipped.length} row(s).`
          : `Imported ${res.imported}, updated ${res.updated}.`
      );
      reload();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setImporting(false);
    }
  };

  const toggleActive = async (p: any) => {
    try {
      await api.patch(`/products/${p.id}`, { active: !p.active });
      toast(p.active ? `${p.description} deactivated — hidden from the quotation picker.` : `${p.description} reactivated.`);
      reload();
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const valid = description.trim() && Number(unitPrice) >= 0 && unitPrice !== "";

  return (
    <>
      <h1 className="page">Price list</h1>
      <p className="pagesub">Products agents can pick from when drafting a quotation — picking one pre-fills description and price, still editable per quote.</p>

      <Card title="Add a product">
        <label className="f" htmlFor="pd">Description</label>
        <input id="pd" className="f" value={description} onChange={(e) => setDescription(e.target.value)} />
        <label className="f" htmlFor="pp">Unit price</label>
        <input id="pp" className="f num" type="number" min={0} step="0.01" placeholder="0.00"
          style={{ maxWidth: 160 }} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
        <button className="btn" disabled={!valid || busy} onClick={add} style={{ marginTop: 12 }}>
          {busy ? "Adding…" : "Add product"}
        </button>
      </Card>

      <Card title="Import from CSV" hint="description, unit_price">
        <p className="dim" style={{ marginTop: -4, marginBottom: 12, fontSize: 12.5 }}>
          Two columns, description then unit price, with or without a header row. A description that matches an existing
          product (case-insensitive) updates its price and reactivates it; anything else is added as new.
        </p>
        <label className="btn" style={{ display: "inline-block", cursor: importing ? "default" : "pointer" }}>
          {importing ? "Importing…" : "Choose CSV file"}
          <input type="file" accept=".csv,text/csv" style={{ display: "none" }} disabled={importing}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
        </label>
        {importResult && importResult.skipped.length > 0 && (
          <ul style={{ marginTop: 12, fontSize: 12.5, color: "var(--red)" }}>
            {importResult.skipped.map((s, i) => <li key={i}>Line {s.line}: {s.reason}</li>)}
          </ul>
        )}
      </Card>

      {error && <ErrorBox msg={error} />}
      <Card title="Products" pad={false}>
        {loading ? <Loading /> : (
          <table className="ledger">
            <thead><tr><th>Description</th><th className="right">Unit price</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(data || []).map((p) => (
                <tr key={p.id}>
                  {editId === p.id ? (
                    <>
                      <td><input className="f" style={{ marginBottom: 0 }} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} /></td>
                      <td className="num right">
                        <input className="f num" style={{ marginBottom: 0, maxWidth: 120 }} type="number" min={0} step="0.01"
                          value={editUnitPrice} onChange={(e) => setEditUnitPrice(e.target.value)} />
                      </td>
                      <td>{p.active ? <span className="chip green">Active</span> : <span className="chip amber">Inactive</span>}</td>
                      <td>
                        <button className="btn sm" disabled={editBusy} onClick={saveEdit}>{editBusy ? "Saving…" : "Save"}</button>{" "}
                        <button className="btn sm ghost" onClick={() => setEditId(null)}>Cancel</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{p.description}</td>
                      <td className="num right">{peso(p.unit_price)}</td>
                      <td>{p.active ? <span className="chip green">Active</span> : <span className="chip amber">Inactive</span>}</td>
                      <td>
                        <button className="btn sm ghost" onClick={() => startEdit(p)}>Edit</button>{" "}
                        <button className="btn sm ghost" onClick={() => toggleActive(p)}>
                          {p.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {!data?.length && <tr><td colSpan={4} className="empty">No products yet — add one above.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
