/**
 * Native API bridge for Project Brain Diary.
 *
 * Drop this in: frontend/lib/native.ts
 *
 * The frontend uses these helpers; behavior is:
 *   - If running inside Capacitor (the APK): uses native camera/GPS plugins
 *   - If running as PWA / web: falls back to browser APIs
 *
 * This means ONE codebase serves both PWA and APK. No fork.
 */

// Conditional import so web bundles don't break when Capacitor isn't installed
let CapApp: any, Camera: any, CameraResultType: any, CameraSource: any,
    Geolocation: any, Preferences: any, Toast: any, Network: any;

const isCapacitor = typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.();

if (isCapacitor) {
  // Dynamically import only when native — keeps bundle slim for web
  ({ App: CapApp } = require('@capacitor/app'));
  ({ Camera, CameraResultType, CameraSource } = require('@capacitor/camera'));
  ({ Geolocation } = require('@capacitor/geolocation'));
  ({ Preferences } = require('@capacitor/preferences'));
  ({ Toast } = require('@capacitor/toast'));
  ({ Network } = require('@capacitor/network'));
}

// ============================================================================
// GPS — high accuracy in native, fallback to browser geolocation
// ============================================================================
export async function getGPS(): Promise<{ lat: number; lng: number; accuracy?: number } | null> {
  try {
    if (isCapacitor) {
      // Request permission if needed
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') {
        const req = await Geolocation.requestPermissions();
        if (req.location !== 'granted') {
          throw new Error('Location permission denied');
        }
      }
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
      });
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
    } else {
      // Web fallback
      return new Promise((resolve) => {
        if (!('geolocation' in navigator)) {
          resolve(null);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });
    }
  } catch (e) {
    console.error('GPS error:', e);
    return null;
  }
}

// ============================================================================
// CAMERA — native picker in app, file input in web
// ============================================================================

/**
 * Captures a single photo. In native, opens the camera app directly.
 * In web, returns null - use a regular <input type="file"> element instead.
 */
export async function captureNativePhoto(): Promise<File | null> {
  if (!isCapacitor) return null;  // web should use file input

  try {
    const photo = await Camera.getPhoto({
      quality: 80,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      allowEditing: false,
      saveToGallery: true,  // also save to phone gallery for backup
    });

    if (!photo.base64String) return null;

    // Convert base64 to File (so existing upload code works unchanged)
    const blob = b64ToBlob(photo.base64String, `image/${photo.format}`);
    return new File([blob], `diary_${Date.now()}.${photo.format}`,
                    { type: `image/${photo.format}` });
  } catch (e: any) {
    if (e.message?.includes('cancelled')) return null;
    console.error('Camera error:', e);
    return null;
  }
}

/**
 * Pick from gallery (native) or fall back to file input (web).
 */
export async function pickFromGallery(): Promise<File | null> {
  if (!isCapacitor) return null;

  try {
    const photo = await Camera.getPhoto({
      quality: 80,
      resultType: CameraResultType.Base64,
      source: CameraSource.Photos,
    });
    if (!photo.base64String) return null;
    const blob = b64ToBlob(photo.base64String, `image/${photo.format}`);
    return new File([blob], `diary_${Date.now()}.${photo.format}`,
                    { type: `image/${photo.format}` });
  } catch {
    return null;
  }
}

function b64ToBlob(b64: string, mime: string): Blob {
  const byteChars = atob(b64);
  const byteNums = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNums[i] = byteChars.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNums)], { type: mime });
}

// ============================================================================
// LOCAL STORAGE — Preferences in native (persists across reinstalls),
//                 localStorage in web
// ============================================================================
export async function storeLocal(key: string, value: string): Promise<void> {
  if (isCapacitor) {
    await Preferences.set({ key, value });
  } else if (typeof window !== 'undefined') {
    localStorage.setItem(key, value);
  }
}

export async function readLocal(key: string): Promise<string | null> {
  if (isCapacitor) {
    const r = await Preferences.get({ key });
    return r.value;
  } else if (typeof window !== 'undefined') {
    return localStorage.getItem(key);
  }
  return null;
}

export async function removeLocal(key: string): Promise<void> {
  if (isCapacitor) {
    await Preferences.remove({ key });
  } else if (typeof window !== 'undefined') {
    localStorage.removeItem(key);
  }
}

// ============================================================================
// TOAST — native toast in app, console.log in web
// ============================================================================
export async function showToast(message: string,
    duration: 'short' | 'long' = 'short'): Promise<void> {
  if (isCapacitor) {
    await Toast.show({ text: message, duration });
  } else if (typeof window !== 'undefined') {
    // Web fallback: just log; or you could use a snackbar lib
    console.log('Toast:', message);
  }
}

// ============================================================================
// NETWORK — check online status, listen for changes
// ============================================================================
export async function isOnline(): Promise<boolean> {
  if (isCapacitor) {
    const status = await Network.getStatus();
    return status.connected;
  } else if (typeof window !== 'undefined') {
    return navigator.onLine;
  }
  return true;
}

export function onNetworkChange(callback: (online: boolean) => void): () => void {
  if (isCapacitor) {
    const sub = Network.addListener('networkStatusChange', (status: any) => {
      callback(status.connected);
    });
    return () => sub.remove();
  } else if (typeof window !== 'undefined') {
    const onOnline = () => callback(true);
    const onOffline = () => callback(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }
  return () => {};
}

// ============================================================================
// PLATFORM INFO
// ============================================================================
export function isNative(): boolean {
  return !!isCapacitor;
}

export function platform(): 'android' | 'ios' | 'web' {
  if (isCapacitor) {
    return (window as any).Capacitor.getPlatform() as 'android' | 'ios';
  }
  return 'web';
}

// ============================================================================
// OFFLINE QUEUE — save diary entries when offline, sync when back online
// ============================================================================
const OFFLINE_QUEUE_KEY = 'pb_diary_offline_queue';

export type QueuedEntry = {
  id: string;
  timestamp: number;
  payload: any;  // formData converted to plain object
  photos: { name: string; base64: string; type: string }[];
  endpoint: string;
};

export async function queueOfflineEntry(entry: Omit<QueuedEntry, 'id' | 'timestamp'>): Promise<void> {
  const queue = await getOfflineQueue();
  queue.push({ ...entry, id: `q_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, timestamp: Date.now() });
  await storeLocal(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

export async function getOfflineQueue(): Promise<QueuedEntry[]> {
  const raw = await readLocal(OFFLINE_QUEUE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export async function clearFromQueue(id: string): Promise<void> {
  const queue = await getOfflineQueue();
  await storeLocal(OFFLINE_QUEUE_KEY, JSON.stringify(queue.filter(q => q.id !== id)));
}

/**
 * Attempt to flush queued offline entries.
 * Call this when network comes back online.
 */
export async function syncOfflineQueue(apiBase: string): Promise<{ synced: number; failed: number }> {
  const queue = await getOfflineQueue();
  let synced = 0, failed = 0;
  for (const entry of queue) {
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(entry.payload)) {
        fd.append(k, String(v));
      }
      for (const photo of entry.photos) {
        const blob = b64ToBlob(photo.base64, photo.type);
        fd.append('photos', new File([blob], photo.name, { type: photo.type }));
      }
      const r = await fetch(`${apiBase}${entry.endpoint}`, { method: 'POST', body: fd });
      if (r.ok) {
        await clearFromQueue(entry.id);
        synced++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }
  return { synced, failed };
}
