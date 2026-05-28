"use client";

import { useEffect, useState } from "react";
import { 
  Plus, Layers, FileText, CheckCircle2, ShieldAlert,
  Calendar, IndianRupee, ClipboardList, RefreshCw 
} from "lucide-react";

const API = "http://localhost:8002/api/v1";

type Pkg = {
  package_id: number;
  package_no: number;
  package_name: string;
};

type Bill = {
  bill_id: number;
  bill_no: string;
  bill_date: string;
  gross_amount_cr: number;
  gst_amount_cr: number;
  retention_amount_cr: number;
  price_variation_cr: number;
  net_payable_cr: number;
  payment_status: string;
};

type Clearance = {
  clearance_id: number;
  gate_name: string;
  cleared_date: string;
  cleared_by: string;
  remarks: string;
};

export default function BillingLedgerPage() {
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [selectedPkgId, setSelectedPkgId] = useState<number | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [clearances, setClearances] = useState<Clearance[]>([]);
  const [loading, setLoading] = useState(false);

  // Form states
  const [showAddBill, setShowAddBill] = useState(false);
  const [billForm, setBillForm] = useState({
    bill_no: "",
    bill_date: new Date().toISOString().split("T")[0],
    gross_amount_cr: "",
    gst_amount_cr: "",
    retention_amount_cr: "",
    price_variation_cr: "",
    net_payable_cr: "",
    payment_status: "pending",
  });

  const [clearanceForm, setClearanceForm] = useState({
    gate_name: "manufacturing",
    cleared_date: new Date().toISOString().split("T")[0],
    cleared_by: "",
    remarks: "",
  });

  // Load packages
  useEffect(() => {
    fetch(`${API}/plan-engine/packages`)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.packages || [];
        setPackages(list);
        if (list.length > 0) setSelectedPkgId(list[0].package_id);
      })
      .catch(() => {});
  }, []);

  // Load package billing details
  useEffect(() => {
    if (!selectedPkgId) return;
    refreshData();
  }, [selectedPkgId]);

  const refreshData = async () => {
    setLoading(true);
    try {
      const [bRes, cRes] = await Promise.all([
        fetch(`${API}/billing/bills/${selectedPkgId}`).then((r) => r.json()),
        fetch(`${API}/billing/clearances/${selectedPkgId}`).then((r) => r.json()),
      ]);
      setBills(Array.isArray(bRes) ? bRes : []);
      setClearances(Array.isArray(cRes) ? cRes : []);
    } catch {
      setBills([]);
      setClearances([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPkgId) return;
    const gross = parseFloat(billForm.gross_amount_cr) || 0;
    const gst = parseFloat(billForm.gst_amount_cr) || 0;
    const ret = parseFloat(billForm.retention_amount_cr) || 0;
    const pv = parseFloat(billForm.price_variation_cr) || 0;
    const net = gross + gst + pv - ret;

    const payload = {
      package_id: selectedPkgId,
      bill_no: billForm.bill_no,
      bill_date: billForm.bill_date,
      gross_amount_cr: gross,
      gst_amount_cr: gst,
      retention_amount_cr: ret,
      price_variation_cr: pv,
      net_payable_cr: net,
      payment_status: billForm.payment_status,
    };

    const res = await fetch(`${API}/billing/bills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setShowAddBill(false);
      setBillForm({
        bill_no: "",
        bill_date: new Date().toISOString().split("T")[0],
        gross_amount_cr: "",
        gst_amount_cr: "",
        retention_amount_cr: "",
        price_variation_cr: "",
        net_payable_cr: "",
        payment_status: "pending",
      });
      refreshData();
    } else {
      alert("Failed to submit bill.");
    }
  };

  const handleUpdateClearance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPkgId) return;

    const payload = {
      package_id: selectedPkgId,
      ...clearanceForm,
    };

    const res = await fetch(`${API}/billing/clearances`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      refreshData();
      setClearanceForm({
        gate_name: "manufacturing",
        cleared_date: new Date().toISOString().split("T")[0],
        cleared_by: "",
        remarks: "",
      });
    } else {
      alert("Failed to update clearance.");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-10 pt-20">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <ClipboardList className="text-cyan-400" />
              Billing Ledger & Clearances
            </h1>
            <p className="text-zinc-400 text-sm mt-1">
              Track RA Bills payment breakdown and milestone gates
            </p>
          </div>
          <div>
            <select
              value={selectedPkgId || ""}
              onChange={(e) => setSelectedPkgId(parseInt(e.target.value) || null)}
              className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm font-medium focus:border-cyan-500/50 outline-none"
            >
              {packages.map((p) => (
                <option key={p.package_id} value={p.package_id}>
                  Pkg #{p.package_no} - {p.package_name.substring(0, 45)}...
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="text-cyan-400 text-center py-20 animate-pulse">Loading Billing details...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Left 2 Cols: RA Bills */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <IndianRupee className="text-cyan-400" size={20} />
                    RA Bills History
                  </h3>
                  <button
                    onClick={() => setShowAddBill(!showAddBill)}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-xs font-bold rounded-lg flex items-center gap-1.5"
                  >
                    <Plus size={14} /> Add RA Bill
                  </button>
                </div>

                {showAddBill && (
                  <form onSubmit={handleAddBill} className="bg-zinc-950 p-4 border border-zinc-800 rounded-xl mb-6 grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Bill No</label>
                      <input
                        required
                        value={billForm.bill_no}
                        onChange={(e) => setBillForm({ ...billForm, bill_no: e.target.value })}
                        className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm w-full outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Bill Date</label>
                      <input
                        type="date"
                        required
                        value={billForm.bill_date}
                        onChange={(e) => setBillForm({ ...billForm, bill_date: e.target.value })}
                        className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm w-full outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Gross Amount (Cr)</label>
                      <input
                        type="number"
                        step="0.0001"
                        required
                        value={billForm.gross_amount_cr}
                        onChange={(e) => setBillForm({ ...billForm, gross_amount_cr: e.target.value })}
                        className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm w-full outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">GST (Cr)</label>
                      <input
                        type="number"
                        step="0.0001"
                        required
                        value={billForm.gst_amount_cr}
                        onChange={(e) => setBillForm({ ...billForm, gst_amount_cr: e.target.value })}
                        className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm w-full outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Retention (Cr)</label>
                      <input
                        type="number"
                        step="0.0001"
                        required
                        value={billForm.retention_amount_cr}
                        onChange={(e) => setBillForm({ ...billForm, retention_amount_cr: e.target.value })}
                        className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm w-full outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Price Variation (Cr)</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={billForm.price_variation_cr}
                        onChange={(e) => setBillForm({ ...billForm, price_variation_cr: e.target.value })}
                        className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm w-full outline-none"
                      />
                    </div>
                    <div className="col-span-2 flex justify-end gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => setShowAddBill(false)}
                        className="px-3 py-2 bg-zinc-800 rounded-lg text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-bold"
                      >
                        Save Bill
                      </button>
                    </div>
                  </form>
                )}

                {bills.length === 0 ? (
                  <p className="text-zinc-500 text-center py-10">No RA bills logged for this package.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="border-b border-zinc-800 text-zinc-400 font-bold uppercase tracking-wider">
                          <th className="py-2.5">Bill No</th>
                          <th className="py-2.5">Date</th>
                          <th className="py-2.5 text-right">Gross</th>
                          <th className="py-2.5 text-right">GST</th>
                          <th className="py-2.5 text-right">Retention</th>
                          <th className="py-2.5 text-right">PV</th>
                          <th className="py-2.5 text-right font-bold">Net Payable</th>
                          <th className="py-2.5 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bills.map((b) => (
                          <tr key={b.bill_id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30">
                            <td className="py-3 font-medium text-white">{b.bill_no}</td>
                            <td className="py-3 text-zinc-400">{b.bill_date}</td>
                            <td className="py-3 text-right text-zinc-300">₹{b.gross_amount_cr} Cr</td>
                            <td className="py-3 text-right text-zinc-300">₹{b.gst_amount_cr} Cr</td>
                            <td className="py-3 text-right text-red-400">₹{b.retention_amount_cr} Cr</td>
                            <td className="py-3 text-right text-zinc-300">₹{b.price_variation_cr} Cr</td>
                            <td className="py-3 text-right font-bold text-cyan-400">₹{b.net_payable_cr} Cr</td>
                            <td className="py-3 text-center">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                b.payment_status === "paid" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                              }`}>
                                {b.payment_status.toUpperCase()}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Right 1 Col: Clearance Gates */}
            <div className="space-y-6">
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
                <h3 className="text-lg font-bold flex items-center gap-2 mb-6">
                  <CheckCircle2 className="text-cyan-400" size={20} />
                  Clearance Gates Status
                </h3>

                <div className="space-y-4">
                  {["manufacturing", "inspection", "dispatch", "site_receipt", "approval"].map((gate) => {
                    const c = clearances.find((x) => x.gate_name === gate);
                    return (
                      <div key={gate} className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-start justify-between gap-4">
                        <div>
                          <div className="text-xs uppercase font-bold text-zinc-400 capitalize">{gate.replace("_", " ")}</div>
                          {c ? (
                            <div className="mt-1 text-xs text-zinc-500">
                              <div>Cleared: <span className="text-emerald-400 font-bold">{c.cleared_date}</span></div>
                              <div>By: {c.cleared_by}</div>
                              {c.remarks && <div className="italic">"{c.remarks}"</div>}
                            </div>
                          ) : (
                            <span className="text-zinc-600 text-xs mt-1 block">Not cleared</span>
                          )}
                        </div>
                        {c && <CheckCircle2 className="text-emerald-400 mt-0.5" size={18} />}
                      </div>
                    );
                  })}
                </div>

                <form onSubmit={handleUpdateClearance} className="mt-6 pt-6 border-t border-zinc-800 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Update Gate Clearance</h4>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Gate</label>
                    <select
                      value={clearanceForm.gate_name}
                      onChange={(e) => setClearanceForm({ ...clearanceForm, gate_name: e.target.value })}
                      className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs w-full outline-none"
                    >
                      <option value="manufacturing">Manufacturing</option>
                      <option value="inspection">Inspection</option>
                      <option value="dispatch">Dispatch</option>
                      <option value="site_receipt">Site Receipt</option>
                      <option value="approval">Approval</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Date</label>
                    <input
                      type="date"
                      required
                      value={clearanceForm.cleared_date}
                      onChange={(e) => setClearanceForm({ ...clearanceForm, cleared_date: e.target.value })}
                      className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs w-full outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Cleared By</label>
                    <input
                      required
                      placeholder="e.g. Inspector Team A"
                      value={clearanceForm.cleared_by}
                      onChange={(e) => setClearanceForm({ ...clearanceForm, cleared_by: e.target.value })}
                      className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs w-full outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Remarks</label>
                    <input
                      value={clearanceForm.remarks}
                      onChange={(e) => setClearanceForm({ ...clearanceForm, remarks: e.target.value })}
                      className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs w-full outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    Clear Gate
                  </button>
                </form>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
