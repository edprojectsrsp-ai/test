"use client";

import { FormEvent, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, Package, Plus } from "lucide-react";

const API_URL = "http://localhost:8000/api/v1";

type Scheme = {
  id: number;
  scheme_name: string;
  current_status: string;
};

type MaterialItem = {
  id: number;
  material_name: string;
  uom: string;
  planned_qty: number;
  received_qty: number;
  consumed_qty: number;
};

export default function MaterialTracking() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [selectedScheme, setSelectedScheme] = useState("");
  const [inventory, setInventory] = useState<MaterialItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMat, setNewMat] = useState({ material_name: "", uom: "MT", planned_qty: "" });
  const [txData, setTxData] = useState({ id: 0, type: "receive", qty: "" });

  useEffect(() => {
    fetch(`${API_URL}/schemes`)
      .then((res) => res.json())
      .then((data) => {
        const activeSchemes = data.filter((scheme: Scheme) => scheme.current_status !== "closed");
        setSchemes(activeSchemes);
        if (activeSchemes.length > 0) setSelectedScheme(activeSchemes[0].id.toString());
      })
      .catch(() => console.error("Unable to load schemes from the backend."));
  }, []);

  const fetchInventory = async (schemeId: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/material/${schemeId}`);
      if (res.ok) {
        const data = await res.json();
        setInventory(data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedScheme) return;

    let active = true;
    const run = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${API_URL}/material/${selectedScheme}`);
        if (!active) return;
        if (res.ok) {
          const data = await res.json();
          if (active) setInventory(data);
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [selectedScheme]);

  const handleAddMaterial = async () => {
    if (!newMat.material_name || !newMat.planned_qty) {
      alert("Name and Planned Qty are required.");
      return;
    }

    try {
      const payload = { ...newMat, planned_qty: Number.parseFloat(newMat.planned_qty) };
      const res = await fetch(`${API_URL}/material/${selectedScheme}/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setShowAddForm(false);
        setNewMat({ material_name: "", uom: "MT", planned_qty: "" });
        fetchInventory(selectedScheme);
      }
    } catch (error) {
      console.error(error);
      alert("Failed to add material.");
    }
  };

  const handleTransaction = async (event: FormEvent) => {
    event.preventDefault();
    if (!txData.id || !txData.qty) {
      alert("Select an item and enter a quantity.");
      return;
    }

    try {
      const qty = Number.parseFloat(txData.qty);
      const payload = {
        id: txData.id,
        received_add: txData.type === "receive" ? qty : 0,
        consumed_add: txData.type === "consume" ? qty : 0,
      };

      const res = await fetch(`${API_URL}/material/transaction`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setTxData({ id: 0, type: "receive", qty: "" });
        fetchInventory(selectedScheme);
        alert(`Successfully logged ${txData.type} transaction.`);
      }
    } catch (error) {
      console.error(error);
      alert("Transaction failed.");
    }
  };

  return (
    <div className="relative min-h-screen p-10 pt-20 text-[var(--ink)]">
      <div className="mb-10 flex items-end justify-between border-b border-[var(--line)] pb-6">
        <div>
          <h1 className="mb-2 flex items-center gap-3 text-4xl font-bold tracking-tight">
            <Package className="h-8 w-8 text-[var(--steel)]" />
            Material Tracking
          </h1>
          <p className="text-lg text-[var(--ink-3)]">Live inventory, procurement, and site consumption</p>
        </div>
        <select
          value={selectedScheme}
          onChange={(event) => setSelectedScheme(event.target.value)}
          className="min-w-[300px] rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-lg font-bold text-[var(--ink)] outline-none focus:border-[var(--steel)]"
        >
          {schemes.map((scheme) => (
            <option key={scheme.id} value={scheme.id}>[{scheme.id}] {scheme.scheme_name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-4">
        <div className="space-y-6 xl:col-span-1">
          <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow-lg)]">
            <h3 className="mb-4 border-b border-[var(--line)] pb-2 text-lg font-bold text-[var(--ink)]">Log Transaction</h3>
            <form onSubmit={handleTransaction} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-[var(--ink-4)]">Item</label>
                <select
                  value={txData.id}
                  onChange={(event) => setTxData({ ...txData, id: Number.parseInt(event.target.value, 10) })}
                  className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-2)] p-2.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--steel)]"
                >
                  <option value={0}>-- Select Material --</option>
                  {inventory.map((item) => (
                    <option key={item.id} value={item.id}>{item.material_name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setTxData({ ...txData, type: "receive" })} className={`flex items-center justify-center gap-1 rounded-lg border py-2 text-sm transition-all ${txData.type === "receive" ? "border-[var(--verdigris)] bg-[var(--verdigris-soft)] text-[var(--verdigris)]" : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--ink-4)] hover:border-[var(--steel-dim)]"}`}>
                  <ArrowDownToLine className="h-4 w-4" /> Receive
                </button>
                <button type="button" onClick={() => setTxData({ ...txData, type: "consume" })} className={`flex items-center justify-center gap-1 rounded-lg border py-2 text-sm transition-all ${txData.type === "consume" ? "border-[var(--ember)] bg-[var(--ember-soft)] text-[var(--ember)]" : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--ink-4)] hover:border-[var(--steel-dim)]"}`}>
                  <ArrowUpFromLine className="h-4 w-4" /> Consume
                </button>
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--ink-4)]">Quantity</label>
                <input type="number" step="0.01" min="0" required value={txData.qty} onChange={(event) => setTxData({ ...txData, qty: event.target.value })} className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-2)] p-2.5 text-[var(--ink)] outline-none focus:border-[var(--steel)]" />
              </div>
              <button type="submit" className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 font-bold text-white ${txData.type === "receive" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-amber-600 hover:bg-amber-500"}`}>
                Confirm {txData.type === "receive" ? "Receipt" : "Usage"}
              </button>
            </form>
          </div>

          <button onClick={() => setShowAddForm(!showAddForm)} className="flex w-full items-center justify-center gap-2 rounded-3xl border border-[var(--line)] bg-[var(--panel)] py-4 font-bold text-[var(--ink)] transition-colors hover:border-[var(--steel-dim)] hover:bg-[var(--panel-2)]">
            <Plus className="h-5 w-5 text-[var(--steel)]" /> Add New Material Item
          </button>

          <AnimatePresence>
            {showAddForm && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden rounded-3xl border border-[var(--steel-dim)] bg-[var(--panel)] p-6 shadow-[var(--shadow)]">
                <div className="space-y-4">
                  <input type="text" placeholder="Material Name (e.g. TMT Bars)" value={newMat.material_name} onChange={(event) => setNewMat({ ...newMat, material_name: event.target.value })} className="w-full rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--steel)]" />
                  <div className="flex gap-2">
                    <select value={newMat.uom} onChange={(event) => setNewMat({ ...newMat, uom: event.target.value })} className="w-1/3 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--steel)]">
                      <option value="MT">MT</option>
                      <option value="Cum">Cum</option>
                      <option value="Nos">Nos</option>
                      <option value="Rmt">Rmt</option>
                    </select>
                    <input type="number" placeholder="Planned Qty" value={newMat.planned_qty} onChange={(event) => setNewMat({ ...newMat, planned_qty: event.target.value })} className="w-full rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--steel)]" />
                  </div>
                  <button onClick={handleAddMaterial} className="w-full rounded-xl bg-purple-600 py-3 text-sm font-bold text-white transition-colors hover:bg-purple-500">Save Item to BOQ</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-col overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-lg)] xl:col-span-3">
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center text-[var(--steel)] animate-pulse">Loading Inventory...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[var(--panel-2)] text-xs uppercase tracking-wider text-[var(--ink-3)]">
                    <th className="p-4 pl-6 font-medium">Material / Item</th>
                    <th className="p-4 font-medium">UOM</th>
                    <th className="p-4 text-right font-medium text-blue-400">Planned BOQ</th>
                    <th className="p-4 text-right font-medium text-emerald-400">Received</th>
                    <th className="p-4 text-right font-medium text-amber-400">Consumed</th>
                    <th className="p-4 pr-6 text-right font-medium">Stock on Hand</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {inventory.length === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-[var(--ink-4)]">No materials registered.</td></tr>
                  )}
                  {inventory.map((item, index) => {
                    const stock = item.received_qty - item.consumed_qty;
                    const isLowStock = stock < item.planned_qty * 0.05;

                    return (
                      <motion.tr initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} key={item.id} className="transition-colors hover:bg-[var(--panel-2)]">
                        <td className="flex items-center gap-2 p-4 pl-6 font-bold text-[var(--ink)]">
                          {isLowStock && <AlertCircle className="h-4 w-4 text-red-500" />}
                          {item.material_name}
                        </td>
                        <td className="p-4 font-mono text-sm text-[var(--ink-4)]">{item.uom}</td>
                        <td className="p-4 text-right font-medium text-blue-400/80">{item.planned_qty.toFixed(2)}</td>
                        <td className="p-4 text-right font-medium text-emerald-400/80">{item.received_qty.toFixed(2)}</td>
                        <td className="p-4 text-right font-medium text-amber-400/80">{item.consumed_qty.toFixed(2)}</td>
                        <td className={`p-4 pr-6 text-right font-bold ${isLowStock ? "text-red-400" : "text-[var(--ink)]"}`}>{stock.toFixed(2)}</td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
