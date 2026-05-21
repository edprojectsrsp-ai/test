"use client";
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Camera, MapPin, Cloud, Users, CheckCircle2, AlertCircle, Loader2, Upload } from "lucide-react";

const API = "http://localhost:8000";
const USER_ID = 1; // TODO: pull from auth session

type Pkg = { package_id: number; package_name: string; scheme_name: string; site_location?: string };
type Activity = { activity_id: number; activity_name: string; uom_code: string; scope_qty: number; cum_actual_qty: number };

export default function MobileDiaryPage() {
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<number | null>(null);
  const [activityId, setActivityId] = useState<number | null>(null);
  const [actualQty, setActualQty] = useState("");
  const [area, setArea] = useState("");
  const [manpower, setManpower] = useState("");
  const [weather, setWeather] = useState("");
  const [remarks, setRemarks] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsErr, setGpsErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${API}/api/v1/mobile/packages-for-me?user_id=${USER_ID}`)
      .then(r => r.json()).then(d => setPackages(d.packages || []));
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        pos => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        err => setGpsErr(err.message),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    } else { setGpsErr("Geolocation not supported"); }
  }, []);

  useEffect(() => {
    if (!selectedPkg) return;
    fetch(`${API}/api/v1/mobile/activities/${selectedPkg}`)
      .then(r => r.json()).then(d => setActivities(d.activities || []));
  }, [selectedPkg]);

  const handlePhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setPhotos(Array.from(e.target.files));
  };

  const submit = async () => {
    if (!activityId || !actualQty) { setErrMsg("Activity & quantity required"); setResult("error"); return; }
    setSubmitting(true); setResult(null); setErrMsg("");
    const fd = new FormData();
    fd.append("activity_id", String(activityId));
    fd.append("actual_date", new Date().toISOString().split("T")[0]);
    fd.append("actual_qty", actualQty);
    fd.append("user_id", String(USER_ID));
    if (area) fd.append("area_of_work", area);
    if (manpower) fd.append("manpower_count", manpower);
    if (weather) fd.append("weather_conditions", weather);
    if (remarks) fd.append("remarks", remarks);
    if (gps) { fd.append("location_lat", String(gps.lat)); fd.append("location_lng", String(gps.lng)); }
    photos.forEach(p => fd.append("photos", p));
    try {
      const r = await fetch(`${API}/api/v1/mobile/diary`, { method: "POST", body: fd });
      if (!r.ok) { setErrMsg(await r.text()); setResult("error"); }
      else {
        setResult("success");
        setActualQty(""); setArea(""); setManpower(""); setRemarks(""); setPhotos([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    } catch (e: any) { setErrMsg(String(e)); setResult("error"); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 max-w-md mx-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold mb-1">Site Diary</h1>
        <p className="text-zinc-400 text-sm mb-4">Quick mobile entry · {new Date().toLocaleDateString()}</p>
      </motion.div>

      {/* GPS status */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 mb-4 flex items-center gap-2 text-sm">
        <MapPin className={`w-4 h-4 ${gps ? "text-emerald-400" : "text-zinc-500"}`} />
        {gps ? <span className="text-emerald-400">{gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}</span>
             : <span className="text-zinc-500">{gpsErr || "Locating..."}</span>}
      </div>

      <Section label="Package">
        <select value={selectedPkg || ""} onChange={e => setSelectedPkg(Number(e.target.value))}
          className="w-full px-3 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-base">
          <option value="">Select package...</option>
          {packages.map(p => <option key={p.package_id} value={p.package_id}>{p.scheme_name} — {p.package_name}</option>)}
        </select>
      </Section>

      {selectedPkg && (
        <Section label="Activity">
          <select value={activityId || ""} onChange={e => setActivityId(Number(e.target.value))}
            className="w-full px-3 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-base">
            <option value="">Select activity...</option>
            {activities.map(a => (
              <option key={a.activity_id} value={a.activity_id}>
                {a.activity_name} ({Number(a.cum_actual_qty).toFixed(1)}/{a.scope_qty || "—"} {a.uom_code || ""})
              </option>
            ))}
          </select>
        </Section>
      )}

      {activityId && (
        <>
          <Section label="Quantity done today">
            <input type="number" inputMode="decimal" value={actualQty} onChange={e => setActualQty(e.target.value)}
              className="w-full px-3 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-base" placeholder="e.g. 25.5" />
          </Section>

          <Section label="Area of work">
            <input type="text" value={area} onChange={e => setArea(e.target.value)}
              className="w-full px-3 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-base" placeholder="e.g. Block 4, Foundation pit" />
          </Section>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <Section label="Manpower" small>
              <div className="relative">
                <Users className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" />
                <input type="number" value={manpower} onChange={e => setManpower(e.target.value)}
                  className="w-full pl-9 pr-3 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-base" placeholder="0" />
              </div>
            </Section>
            <Section label="Weather" small>
              <div className="relative">
                <Cloud className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" />
                <input type="text" value={weather} onChange={e => setWeather(e.target.value)}
                  className="w-full pl-9 pr-3 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-base" placeholder="Clear" />
              </div>
            </Section>
          </div>

          <Section label="Remarks (optional)">
            <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2}
              className="w-full px-3 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-base resize-none" placeholder="Any notes..." />
          </Section>

          <Section label="Photos (camera works on phone)">
            <label className="flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-zinc-700 rounded-lg cursor-pointer hover:border-indigo-500">
              <Camera className="w-5 h-5" />
              <span className="text-sm">{photos.length ? `${photos.length} photo(s) selected` : "Tap to add photos"}</span>
              <input type="file" accept="image/*" capture="environment" multiple
                ref={fileInputRef} onChange={handlePhotos} className="hidden" />
            </label>
          </Section>

          <motion.button onClick={submit} disabled={submitting}
            whileTap={{ scale: 0.95 }}
            className="w-full mt-4 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 rounded-lg font-semibold text-lg flex items-center justify-center gap-2">
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
            {submitting ? "Saving..." : "Submit Diary Entry"}
          </motion.button>

          {result === "success" && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
              <span>Diary entry saved successfully</span>
            </motion.div>
          )}
          {result === "error" && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm">{errMsg || "Failed to save"}</span>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}

function Section({ label, children, small = false }: { label: string; children: React.ReactNode; small?: boolean }) {
  return (
    <div className={small ? "" : "mb-3"}>
      <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
