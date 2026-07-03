FROM nginx:alpine

# Build context is the project root (see docker-compose.yml).
COPY frontend/ /usr/share/nginx/html/
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80