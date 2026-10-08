"""Gunicorn production settings for the small SQLite-backed API."""

import os


bind = "0.0.0.0:8000"
workers = max(1, int(os.environ.get("VT_GUNICORN_WORKERS", "2")))
threads = max(1, int(os.environ.get("VT_GUNICORN_THREADS", "2")))
worker_class = "gthread"
preload_app = True
timeout = 30
graceful_timeout = 30
keepalive = 5
max_requests = 2_000
max_requests_jitter = 200
worker_tmp_dir = "/dev/shm"

# UUID lookup URLs are bearer capabilities. Keep them out of default access
# logs; nginx also disables access logging for the feedback API location.
accesslog = None
errorlog = "-"
capture_output = True
loglevel = os.environ.get("VT_LOG_LEVEL", "info")
