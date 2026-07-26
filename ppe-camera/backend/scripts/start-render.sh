#!/bin/sh
set -eu

PPE_RUNTIME_ROOT="${PPE_ROOT:-/tmp/ppe}"
PPE_ZOO_DIR="$PPE_RUNTIME_ROOT/data/weights/zoo"

mkdir -p \
  "$PPE_ZOO_DIR" \
  "$PPE_RUNTIME_ROOT/data/captures" \
  "$PPE_RUNTIME_ROOT/data/datasets" \
  "$PPE_RUNTIME_ROOT/data/exports"

# Free Render storage is ephemeral. Restore the bundled trained models on every
# boot so selection works without downloads or Neon/object-storage usage.
cp /opt/ppe-models/snehil-demo.pt "$PPE_ZOO_DIR/snehil-demo.pt"
cp /opt/ppe-models/voxdroid-enterprise.pt "$PPE_ZOO_DIR/voxdroid-enterprise.pt"
cp /opt/ppe-models/nduka1999.onnx "$PPE_ZOO_DIR/nduka1999.onnx"
cp /opt/ppe-models/hexmon-vyra.pt "$PPE_ZOO_DIR/hexmon-vyra.pt"

cd /srv/ppe
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8004}"
