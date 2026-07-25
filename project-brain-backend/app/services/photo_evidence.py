"""
Photo evidence verification for DPR entries.

`dpr_entries_v2` already captures GPS from the browser at the moment the entry
is made, and `dpr_photos` already stores an attached image. Nothing, however,
connects the two: the photo is whatever file was selected. A gallery image taken
three weeks ago at a different site attaches to a live-GPS entry and looks
identical to one taken on the spot.

That matters because the photo is the evidence behind a billing claim. When a
contractor disputes a measurement, "there is a photo" is worth very little;
"this photo's own EXIF places it 12 m from the recorded entry point, four
minutes before the entry was saved" is worth a great deal.

This module reads the photo's embedded EXIF and corroborates it against the
entry. It deliberately does not reject anything on its own — many legitimate
site photos have EXIF stripped by messaging apps, and a hard reject would push
engineers back to paper. It classifies, records why, and leaves the decision to
a human with the reasons in front of them.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

# Verification outcomes, worst-first when several apply.
VERIFIED = "verified"          # EXIF corroborates place and time
UNVERIFIED = "unverified"      # no EXIF to check against — common and not damning
SUSPECT = "suspect"            # EXIF present and disagrees
CONFLICTED = "conflicted"      # EXIF is internally impossible

EARTH_RADIUS_M = 6_371_000.0


@dataclass
class VerificationPolicy:
    """Tolerances. Defaults suit a construction site, not a laboratory."""

    # Consumer GPS on a phone is routinely 5-20 m out, and worse beside steel
    # structures or inside a shed. 150 m accepts the same work front while still
    # catching a photo from another part of the plant.
    max_distance_m: float = 150.0

    # A site engineer photographs work, walks back, and writes the entry. An
    # hour of slack covers that without accepting yesterday's photo.
    max_time_delta_s: float = 3600.0

    # Beyond this the photo is not of today's work at all.
    hard_time_delta_s: float = 86400.0

    # Below this GPS accuracy the fix is too vague to argue about either way.
    ignore_below_accuracy_m: float = 500.0

    require_exif: bool = False     # if True, missing EXIF becomes SUSPECT


@dataclass
class PhotoEvidence:
    """What we could read out of the photo itself."""
    lat: float | None = None
    lng: float | None = None
    taken_at: datetime | None = None
    accuracy_m: float | None = None
    camera_make: str | None = None
    camera_model: str | None = None
    software: str | None = None    # non-empty often means edited/re-encoded

    @property
    def has_gps(self) -> bool:
        return self.lat is not None and self.lng is not None

    @property
    def has_time(self) -> bool:
        return self.taken_at is not None


@dataclass
class VerificationResult:
    status: str
    distance_m: float | None = None
    time_delta_s: float | None = None
    reasons: list[str] = field(default_factory=list)
    evidence: PhotoEvidence | None = None

    @property
    def is_defensible(self) -> bool:
        """Would this photo survive a contractor challenging the measurement?"""
        return self.status == VERIFIED

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "distance_m": None if self.distance_m is None else round(self.distance_m, 1),
            "time_delta_s": None if self.time_delta_s is None else int(self.time_delta_s),
            "reasons": self.reasons,
            "defensible": self.is_defensible,
        }


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = (math.sin(dp / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2)
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def _humanise_delta(seconds: float) -> str:
    """Phrase a gap in the unit a reader would use, so a full day never reads
    as '24.0 h'."""
    if seconds >= 86400:
        return f"{seconds / 86400:.1f} days"
    if seconds >= 3600:
        return f"{seconds / 3600:.1f} h"
    return f"{seconds / 60:.0f} min"


def _to_degrees(value) -> float | None:
    """EXIF stores coordinates as three rationals: degrees, minutes, seconds."""
    try:
        d, m, s = value
        to_f = lambda x: (float(x[0]) / float(x[1])
                          if isinstance(x, tuple) else float(x))
        return to_f(d) + to_f(m) / 60.0 + to_f(s) / 3600.0
    except Exception:
        return None


def extract_exif(path: str) -> PhotoEvidence:
    """Read EXIF from a JPEG. Returns an empty record if unreadable.

    Never raises: a corrupt or stripped photo must still be attachable to an
    entry, it simply cannot be corroborated.
    """
    try:
        from PIL import ExifTags, Image
    except ImportError:
        return PhotoEvidence()

    try:
        with Image.open(path) as img:
            raw = img._getexif() or {}
    except Exception:
        return PhotoEvidence()

    tags = {ExifTags.TAGS.get(k, k): v for k, v in raw.items()}
    ev = PhotoEvidence(
        camera_make=str(tags.get("Make") or "").strip() or None,
        camera_model=str(tags.get("Model") or "").strip() or None,
        software=str(tags.get("Software") or "").strip() or None,
    )

    for key in ("DateTimeOriginal", "DateTimeDigitized", "DateTime"):
        if tags.get(key):
            try:
                ev.taken_at = datetime.strptime(str(tags[key]), "%Y:%m:%d %H:%M:%S")
                break
            except ValueError:
                continue

    gps_raw = raw.get(34853) or tags.get("GPSInfo")
    if isinstance(gps_raw, dict):
        gps = {ExifTags.GPSTAGS.get(k, k): v for k, v in gps_raw.items()}
        lat = _to_degrees(gps.get("GPSLatitude"))
        lng = _to_degrees(gps.get("GPSLongitude"))
        if lat is not None and lng is not None:
            if str(gps.get("GPSLatitudeRef", "N")).upper().startswith("S"):
                lat = -lat
            if str(gps.get("GPSLongitudeRef", "E")).upper().startswith("W"):
                lng = -lng
            ev.lat, ev.lng = lat, lng
        dop = gps.get("GPSDOP")
        if dop is not None:
            try:
                ev.accuracy_m = (float(dop[0]) / float(dop[1])
                                 if isinstance(dop, tuple) else float(dop))
            except Exception:
                pass
    return ev


def verify_photo(
    evidence: PhotoEvidence,
    entry_lat: float | None,
    entry_lng: float | None,
    entry_time: datetime | None,
    entry_accuracy_m: float | None = None,
    policy: VerificationPolicy | None = None,
) -> VerificationResult:
    """Corroborate a photo against the entry it is attached to."""
    p = policy or VerificationPolicy()
    reasons: list[str] = []
    distance: float | None = None
    time_delta: float | None = None

    # --- internal consistency first: a future photo is impossible ------------
    if evidence.taken_at and evidence.taken_at > datetime.now() + timedelta(days=1):
        reasons.append("Photo EXIF timestamp is in the future — camera clock is "
                       "wrong or the file has been altered.")
        return VerificationResult(CONFLICTED, None, None, reasons, evidence)

    if not evidence.has_gps and not evidence.has_time:
        reasons.append("Photo carries no EXIF location or timestamp. Messaging "
                       "apps and screenshots strip it, so this is common and "
                       "not itself evidence of anything.")
        status = SUSPECT if p.require_exif else UNVERIFIED
        return VerificationResult(status, None, None, reasons, evidence)

    # --- location ------------------------------------------------------------
    gps_ok: bool | None = None
    if evidence.has_gps and entry_lat is not None and entry_lng is not None:
        distance = haversine_m(evidence.lat, evidence.lng, entry_lat, entry_lng)
        # Widen the gate by the fix uncertainty we actually know about, rather
        # than failing a photo for imprecision the device already reported.
        slack = max(entry_accuracy_m or 0.0, evidence.accuracy_m or 0.0)
        if slack >= p.ignore_below_accuracy_m:
            reasons.append(f"GPS accuracy is {slack:.0f} m, too vague to "
                           "confirm or deny the location.")
            gps_ok = None
        elif distance <= p.max_distance_m + slack:
            gps_ok = True
            reasons.append(f"Photo location agrees with the entry ({distance:.0f} m apart).")
        else:
            gps_ok = False
            reasons.append(f"Photo was taken {distance:.0f} m from the recorded "
                           f"entry point, beyond the {p.max_distance_m:.0f} m tolerance.")
    elif evidence.has_gps:
        reasons.append("Entry has no GPS to compare the photo against.")
    else:
        reasons.append("Photo has no embedded location.")

    # --- time ----------------------------------------------------------------
    time_ok: bool | None = None
    if evidence.has_time and entry_time is not None:
        time_delta = abs((evidence.taken_at - entry_time).total_seconds())
        gap = _humanise_delta(time_delta)
        if time_delta >= p.hard_time_delta_s:
            time_ok = False
            reasons.append(f"Photo was taken {gap} from the entry date — it is "
                           "not a photo of this day's work.")
        elif time_delta > p.max_time_delta_s:
            time_ok = False
            reasons.append(f"Photo timestamp is {gap} from the entry, beyond "
                           "tolerance.")
        else:
            time_ok = True
            reasons.append(f"Photo timestamp agrees with the entry ({gap} apart).")
    elif evidence.has_time:
        reasons.append("Entry has no timestamp to compare against.")
    else:
        reasons.append("Photo has no embedded timestamp.")

    # --- verdict -------------------------------------------------------------
    # A single disagreement is enough to mark suspect: the point of the check is
    # to surface doubt, and a photo in the right place on the wrong day is
    # exactly the case worth flagging.
    if gps_ok is False or time_ok is False:
        status = SUSPECT
    elif gps_ok is True or time_ok is True:
        status = VERIFIED
    else:
        status = UNVERIFIED

    if evidence.software and status == VERIFIED:
        reasons.append(f"Note: image reports editing software "
                       f"({evidence.software}); re-encoding can rewrite EXIF.")

    return VerificationResult(status, distance, time_delta, reasons, evidence)


def verify_photo_file(
    path: str,
    entry_lat: float | None,
    entry_lng: float | None,
    entry_time: datetime | None,
    entry_accuracy_m: float | None = None,
    policy: VerificationPolicy | None = None,
) -> VerificationResult:
    """Convenience: read EXIF from disk, then verify."""
    return verify_photo(extract_exif(path), entry_lat, entry_lng, entry_time,
                        entry_accuracy_m, policy)
