"use client";
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Camera, MapPin, Cloud, Users, CheckCircle2, AlertCircle, Loader2, Upload,
  Wifi, WifiOff, RefreshCw, Smartphone
} from "lucide-react";
import {
  getGPS, captureNativePhoto, pickFromGallery, isNative, platform,
  onNetworkChange, isOnline, queueOfflineEntry, getOfflineQueue,
  syncOfflineQueue, showToast,
} from "@/lib/native";

const API = "http://localhost:8000";
const USER_ID = 1;

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
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [gpsErr, setGpsErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<"success" | "error" | "queued" | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [online, setOnline] = useState(true);
  const [queueLen, setQueueLen] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const nativeMode = isNative();
  const plat = platform();

  // Initial GPS + network status + offline queue
  useEffect(() => {
    (async () => {
      const pos = await getGPS();
      if (pos) setGps(pos);
      else setGpsErr("GPS unavailable - grant permission and retry");

      setOnline(await isOnline());
      const q = await getOfflineQueue();
      setQueueLen(q.length);
    })();

    // Network listener — auto-sync when back online
    const unsub = onNetworkChange(async (isOn) => {
      setOnline(isOn);
      if (isOn) {
        const q = await getOfflineQueue();
        if (q.length > 0) {
          showToast(`Back online - syncing ${q.length} queued entries...`, 'long');
          await syncQueue();
        }
      }
    });
    return unsub;
  }, []);

  // Load packages for this user (if online)
  useEffect(() => {
    if (!online) return;
    fetch(`${API}/api/v1/mobile/packages-for-me?user_id=${USER_ID}`)
      .then(r => r.json()).then(d => setPackages(d.packages || []))
      .catch(() => {/* offline — packages list will be empty */});
  }, [online]);

  // Load activities for selected package
  useEffect(() => {
    if (!selectedPkg || !online) return;
    fetch(`${API}/api/v1/mobile/activities/${selectedPkg}`)
      .then(r => r.json()).then(d => setActivities(d.activities || []));
  }, [selectedPkg, online]);

  // Native photo capture
  const takePhoto = async () => {
    if (nativeMode) {
      const f = await captureNativePhoto();
      if (f) setPhotos(p => [...p, f]);
    } else {
      fileInputRef.current?.click();
    }
  };

  const pickPhoto = async () => {
    if (nativeMode) {
      const f = await pickFromGallery();
      if (f) setPhotos(p => [...p, f]);
    } else {
      fileInputRef.current?.click();
    }
  };

  const handlePhotosInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setPhotos(p => [...p, ...Array.from(e.target.files!)]);
  };

  const refreshGPS = async () => {
    setGpsErr(null);
    const pos = await getGPS();
    if (pos) setGps(pos);
    else setGpsErr("GPS unavailable");
  };

  const syncQueue = async () => {
    setSyncing(true);
    const r = await syncOfflineQueue(API);
    setSyncing(false);
    const q = await getOfflineQueue();
    setQueueLen(q.length);
    if (r.synced > 0) {
      showToast(`Synced ${r.synced} entries${r.failed > 0 ? `, ${r.failed} failed` : ''}`, 'long');
    }
  };

  const submit = async () => {
    if (!selectedPkg || !activityId) { setErrMsg("Pick package and activity"); return; }
    setSubmitting(true);
    setErrMsg("");

    const payload = {
      package_id: selectedPkg,
      activity_id: activityId,
      actual_qty: parseFloat(actualQty) || 0,
      area,
      manpower: manpower ? parseInt(manpower) : null,
      weather,
      remarks,
      lat: gps?.lat,
      lng: gps?.lng,
      user_id: USER_ID,
    };

    // If offline → queue
    if (!online) {
      const photosB64 = await Promise.all(photos.map(async (f) => ({
        name: f.name,
        type: f.type,
        base64: await fileToBase64(f),
      })));
      await queueOfflineEntry({
        payload,
        photos: photosB64,
        endpoint: "/api/v1/mobile/diary/submit",
      });
      const q = await getOfflineQueue();
      setQueueLen(q.length);
      setResult("queued");
      resetForm();
      setSubmitting(false);
      showToast("Saved offline - will sync when online", "long");
      return;
    }

    // Online submit
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(payload)) {
        if (v != null) fd.append(k, String(v));
      }
      photos.forEach(p => fd.append("photos", p));
      const r = await fetch(`${API}/api/v1/mobile/diary/submit`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setResult("success");
      resetForm();
      showToast("Diary entry saved", "short");
    } catch (e: any) {
      setResult("error");
      setErrMsg(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setActualQty(""); setArea(""); setManpower(""); setWeather(""); setRemarks(""); setPhotos([]);
    setActivityId(null);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 pb-24">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-emerald-400" />
            Site Diary
          </h1>
          <p className="text-xs text-zinc-500">
            {nativeMode ? `Native ${plat}` : 'Web (PWA)'} ·
            {online ? <span className="text-emerald-400 ml-1">online</span> : <span className="text-amber-400 ml-1">offline</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {queueLen > 0 && (
            <button onClick={syncQueue} disabled={syncing || !online}
              className="flex items-center gap-1 px-2 py-1 bg-amber-500/20 border border-amber-500/30 rounded text-xs text-amber-200">
              <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
              {queueLen} queued
            </button>
          )}
          {online ? <Wifi className="w-4 h-4 text-emerald-400" /> : <WifiOff className="w-4 h-4 text-amber-400" />}
        </div>
      </div>

      {/* GPS card */}
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
        className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className={`w-5 h-5 ${gps ? "text-emerald-400" : "text-amber-400"}`} />
          {gps ? (
            <div className="text-xs">
              <div className="font-mono text-zinc-200">{gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}</div>
              {gps.accuracy != null && (
                <div className="text-zinc-500">±{Math.round(gps.accuracy)}m accuracy</div>
              )}
            </div>
          ) : (
            <div className="text-xs text-amber-400">{gpsErr || "Acquiring GPS..."}</div>
          )}
        </div>
        <button onClick={refreshGPS} className="p-2 hover:bg-zinc-800 rounded">
          <RefreshCw className="w-4 h-4 text-zinc-400" />
        </button>
      </motion.div>

      {/* Package selector */}
      <div className="mb-3">
        <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5 block">Package</label>
        <select value={selectedPkg || ""} onChange={e => setSelectedPkg(Number(e.target.value) || null)}
          className="w-full px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm">
          <option value="">Choose package...</option>
          {packages.map(p => (
            <option key={p.package_id} value={p.package_id}>
              {p.scheme_name} · {p.package_name}
            </option>
          ))}
        </select>
      </div>

      {/* Activity selector */}
      {selectedPkg && (
        <div className="mb-3">
          <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5 block">Activity</label>
          <select value={activityId || ""} onChange={e => setActivityId(Number(e.target.value) || null)}
            className="w-full px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm">
            <option value="">Choose activity...</option>
            {activities.map(a => (
              <option key={a.activity_id} value={a.activity_id}>
                {a.activity_name} ({a.cum_actual_qty}/{a.scope_qty} {a.uom_code})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Inputs */}
      <div className="space-y-3 mb-4">
        <input value={actualQty} onChange={e => setActualQty(e.target.value)}
          type="number" inputMode="decimal" placeholder="Qty done today"
          className="w-full px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm" />
        <input value={area} onChange={e => setArea(e.target.value)}
          placeholder="Area / location (e.g. Bay-3)"
          className="w-full px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm" />
        <input value={manpower} onChange={e => setManpower(e.target.value)}
          type="number" inputMode="numeric" placeholder="Manpower deployed"
          className="w-full px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm" />
        <select value={weather} onChange={e => setWeather(e.target.value)}
          className="w-full px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm">
          <option value="">Weather...</option>
          <option value="clear">Clear</option>
          <option value="cloudy">Cloudy</option>
          <option value="rain_light">Rain (light)</option>
          <option value="rain_heavy">Rain (heavy)</option>
          <option value="hot_humid">Hot & humid</option>
        </select>
        <textarea value={remarks} onChange={e => setRemarks(e.target.value)}
          placeholder="Remarks (issues, observations, hindrances...)" rows={3}
          className="w-full px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm resize-none" />
      </div>

      {/* Photo capture */}
      <div className="mb-4">
        <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5 block">
          Photos ({photos.length})
        </label>
        <div className="flex gap-2 mb-2">
          <button onClick={takePhoto}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-500/20 border border-emerald-500/30 rounded-lg text-emerald-200">
            <Camera className="w-5 h-5" />
            {nativeMode ? "Camera" : "Take Photo"}
          </button>
          <button onClick={pickPhoto}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-zinc-900 border border-zinc-800 rounded-lg">
            <Upload className="w-5 h-5" />
            Gallery
          </button>
        </div>

        {/* Hidden file input for web fallback */}
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" multiple
          onChange={handlePhotosInput} className="hidden" />

        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-2">
            {photos.map((p, i) => (
              <div key={i} className="relative aspect-square bg-zinc-900 rounded overflow-hidden">
                <img src={URL.createObjectURL(p)} className="w-full h-full object-cover" alt="" />
                <button onClick={() => setPhotos(ps => ps.filter((_, idx) => idx !== i))}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs">×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Submit */}
      <button onClick={submit} disabled={submitting || !selectedPkg || !activityId}
        className={`w-full py-3.5 rounded-lg font-semibold text-sm ${
          online
            ? "bg-emerald-500 hover:bg-emerald-400 text-zinc-950 disabled:opacity-50"
            : "bg-amber-500 hover:bg-amber-400 text-zinc-950 disabled:opacity-50"
        }`}>
        {submitting ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> :
         online ? "Submit Entry" : "Save Offline (will sync later)"}
      </button>

      {/* Result toast */}
      {result === "success" && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-4 left-4 right-4 bg-emerald-500/20 border border-emerald-500/40 rounded-lg p-3 flex items-center gap-2 text-emerald-200">
          <CheckCircle2 className="w-5 h-5" />Diary entry submitted
        </motion.div>
      )}
      {result === "queued" && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-4 left-4 right-4 bg-amber-500/20 border border-amber-500/40 rounded-lg p-3 flex items-center gap-2 text-amber-200">
          <Cloud className="w-5 h-5" />Saved offline - will auto-sync
        </motion.div>
      )}
      {result === "error" && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-4 left-4 right-4 bg-red-500/20 border border-red-500/40 rounded-lg p-3 flex items-center gap-2 text-red-200">
          <AlertCircle className="w-5 h-5" />Error: {errMsg}
        </motion.div>
      )}
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
