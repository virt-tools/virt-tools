FROM nginx:alpine

# Build context is the project root (see docker-compose.yml).
COPY frontend/ /usr/share/nginx/html/
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf

# Cache-bust asset URLs so returning visitors always load the latest JS/CSS.
# A build-time version query (?v=...) is appended to every assets/*.js|css
# reference in the HTML. Because index.html is served with Cache-Control:
# no-cache, clients always revalidate the HTML and therefore always see the
# newest ?v, forcing a fresh fetch of changed assets and bypassing any stale
# heuristic-cached copies from before the no-cache header existed.
# Re-runs (new V) only when the frontend/ COPY layer changes, i.e. on edits.
RUN V=$(date +%s) && \
    find /usr/share/nginx/html -type f -name '*.html' \
      -exec sed -i -E "s#(assets/[A-Za-z0-9_.-]+\.js)([\"'])#\1?v=$V\2#g" {} \; && \
    find /usr/share/nginx/html -type f -name '*.html' \
      -exec sed -i -E "s#(assets/[A-Za-z0-9_.-]+\.css)([\"'])#\1?v=$V\2#g" {} \;

EXPOSE 80