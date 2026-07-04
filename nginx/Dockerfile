# Stage 1: build-time SEO + sitemap generation.
# Uses python for robust HTML/JSON escaping when injecting meta tags and JSON-LD
# into every page from the tool registry. These artifacts are static files, so the
# runtime nginx image below needs none of this tooling.
FROM python:3.13-alpine AS seo
WORKDIR /build
COPY frontend/ ./frontend/
COPY scripts/generate_seo.py ./generate_seo.py
COPY scripts/generate_sitemap.sh ./generate_sitemap.sh
RUN python generate_seo.py frontend https://virt.tools
RUN sh generate_sitemap.sh frontend https://virt.tools

# Stage 2: runtime nginx.
FROM nginx:alpine

# Build context is the project root (see docker-compose.yml). Copy the
# SEO/sitemap-enriched frontend from the generator stage.
COPY --from=seo /build/frontend/ /usr/share/nginx/html/
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf

# Cache-bust asset URLs so returning visitors always load the latest JS/CSS.
# A build-time version query (?v=...) is appended to every assets/*.js|css
# reference in the HTML. Because index.html is served with Cache-Control:
# no-cache, clients always revalidate the HTML and therefore always see the
# newest ?v, forcing a fresh fetch of changed assets and bypassing any stale
# heuristic-cached copies from before the no-cache header existed.
# Re-runs (new V) only when the frontend/ COPY layer changes, i.e. on edits.
# Note: the SEO block injected above contains no assets/*.js|css references,
# so it is left untouched here.
RUN V=$(date +%s) && \
    find /usr/share/nginx/html -type f -name '*.html' \
      -exec sed -i -E "s#(assets/[A-Za-z0-9_.-]+\.js)([\"'])#\1?v=$V\2#g" {} \; && \
    find /usr/share/nginx/html -type f -name '*.html' \
      -exec sed -i -E "s#(assets/[A-Za-z0-9_.-]+\.css)([\"'])#\1?v=$V\2#g" {} \;

EXPOSE 80