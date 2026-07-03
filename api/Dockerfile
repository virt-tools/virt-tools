FROM python:3.13-alpine

WORKDIR /app

# Build context is the project root (see docker-compose.yml), so we can pull in
# both the API and the offline admin tool.
COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY api/app.py api/db.py ./
COPY scripts/ ./scripts/

# SQLite data volume mount point.
VOLUME ["/data"]

EXPOSE 8000
CMD ["python", "app.py"]