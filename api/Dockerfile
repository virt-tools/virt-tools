FROM python:3.13-alpine3.22@sha256:e81548ac35b07a3bd4805f275107592ef458b1e893c0e04d45aedaa19416cca5

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Digest pins do not include security fixes published after the image build.
RUN apk upgrade --no-cache \
    && apk add --no-cache openssl \
    && addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app \
    && install -d -o app -g app -m 0700 /data

COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt

COPY --chown=app:app api/app.py api/db.py api/feedback_policy.py api/gunicorn.conf.py ./
COPY --chown=app:app scripts/manage_feedback.py scripts/feedback_backup.py ./scripts/

VOLUME ["/data"]
USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=4 \
    CMD ["python", "-c", "import json,urllib.request; assert json.load(urllib.request.urlopen('http://127.0.0.1:8000/api/ready', timeout=2))['ok']"]

CMD ["gunicorn", "--config", "gunicorn.conf.py", "app:app"]
