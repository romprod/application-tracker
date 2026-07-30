# syntax=docker/dockerfile:1

FROM python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7 AS egress

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY --chmod=0444 policy.py egress_proxy.py ./

USER 65534:65534

CMD ["python", "/app/egress_proxy.py"]

FROM python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7 AS worker

ARG CAMOUFOX_BROWSER_SHA256=924f3109ccd6d47cd6a0384d67a345fadf975d48b6319f8dbbd5954c588982bd
ARG CAMOUFOX_BROWSER_URL=https://github.com/daijro/camoufox/releases/download/v152.0.4-beta.28/camoufox-152.0.4-beta.28-lin.x86_64.zip

ENV HOME=/tmp/home \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    XDG_CACHE_HOME=/opt

WORKDIR /app

COPY --chmod=0444 requirements.lock ./

RUN python -m pip install --no-cache-dir --requirement requirements.lock \
    && python -m playwright install-deps firefox \
    && python -c "import urllib.request; urllib.request.urlretrieve('${CAMOUFOX_BROWSER_URL}', '/tmp/camoufox.zip')" \
    && echo "${CAMOUFOX_BROWSER_SHA256}  /tmp/camoufox.zip" | sha256sum --check --strict \
    && mkdir --parents /opt/camoufox \
    && python -m zipfile --extract /tmp/camoufox.zip /opt/camoufox \
    && chmod --recursive 0555 /opt/camoufox \
    && test -x /opt/camoufox/camoufox-bin \
    && rm /tmp/camoufox.zip \
    && chown --recursive 65534:65534 /opt/camoufox

COPY --chmod=0444 camoufox-config.json /opt/camoufox/config.json
COPY --chmod=0444 camoufox-version.json /opt/camoufox/version.json
COPY --chmod=0444 camoufox-cache-compatibility /opt/camoufox/.0.5_FLAG
COPY --chmod=0444 policy.py worker.py ./

USER 65534:65534

EXPOSE 8080

CMD ["python", "/app/worker.py"]
