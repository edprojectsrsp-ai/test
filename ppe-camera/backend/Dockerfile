# Cloud role only (PPE_ROLE=cloud): violations dashboard + sync receiver.
#
# The edge/plant-PC deployment is NOT a container -- it is the Windows
# installer under installer/, because it needs the host's GPU and the cameras
# on the host's LAN.
#
# This image deliberately installs requirements.cloud.txt, not requirements.txt.
# The previous build installed the full ML stack (torch via ultralytics, plus
# opencv and its ffmpeg/libgl system libraries) into a 512 MB free instance,
# which exhausted memory during import. Nothing here decodes video or runs a
# model, so ffmpeg and libgl are gone too.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PPE_ROLE=cloud \
    PPE_DEVICE=cpu

WORKDIR /app

COPY requirements.cloud.txt .
RUN pip install --upgrade pip setuptools wheel && \
    pip install -r requirements.cloud.txt

COPY app ./app
RUN mkdir -p ./data
COPY .env.example ./.env.example
COPY README.md ./README.md

ENV PORT=8004

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8004}"]
