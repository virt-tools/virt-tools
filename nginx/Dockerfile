# Build images use digest-pinned release lines; Python and Node never reach runtime.
ARG ASSET_VERSION=""
FROM node:22-alpine3.22@sha256:cd7807368cf24826297cbad5dca1a44972ccfd770647db52a8c7589eb4599ac8 AS javascript
WORKDIR /build
COPY frontend/ ./frontend/
COPY scripts/validate_javascript.mjs ./validate_javascript.mjs
COPY scripts/validate_formula_workbenches.mjs ./validate_formula_workbenches.mjs
COPY formula-workbenches.json ./formula-workbenches.json
COPY tests/security/math-expression.test.cjs ./tests/security/math-expression.test.cjs
RUN node validate_javascript.mjs frontend \
    && node validate_formula_workbenches.mjs /build \
    && node tests/security/math-expression.test.cjs \
    && touch /build/javascript-validation-ok

FROM python:3.14-alpine3.22@sha256:6b91e66ab2a880ce9ca5a1b91c70f45963ff71ff68268df056336e1a657d5efd AS seo
ARG ASSET_VERSION
WORKDIR /build
COPY --from=javascript /build/javascript-validation-ok ./javascript-validation-ok
COPY frontend/ ./frontend/
COPY scripts/generate_seo.py ./generate_seo.py
COPY scripts/generate_sitemap.sh ./generate_sitemap.sh
COPY scripts/generate_tool_catalog.py ./generate_tool_catalog.py
COPY scripts/generate_formula_workbenches.py ./generate_formula_workbenches.py
COPY scripts/validate_tools.py ./validate_tools.py
COPY scripts/validate_formula_workbenches.py ./validate_formula_workbenches.py
COPY scripts/validate_generated_conversions.py ./validate_generated_conversions.py
COPY scripts/validate_tool_design.py ./validate_tool_design.py
COPY scripts/validate_risk_policy.py ./validate_risk_policy.py
COPY scripts/validate_browser_security.py ./scripts/validate_browser_security.py
COPY scripts/browser-security-policy.json ./scripts/browser-security-policy.json
COPY tests/security/malicious-inputs.json ./tests/security/malicious-inputs.json
COPY scripts/prune_deploy_tree.py ./prune_deploy_tree.py
COPY tool-curation.json ./tool-curation.json
COPY tool-risk-policy.json ./tool-risk-policy.json
COPY individual-tool-audit.json ./individual-tool-audit.json
COPY generated-conversion-tools.json ./generated-conversion-tools.json
COPY nginx/tool-redirects.conf ./nginx/tool-redirects.conf
COPY formula-workbenches.json ./formula-workbenches.json
COPY formula-workbenches.schema.json ./formula-workbenches.schema.json
RUN python generate_tool_catalog.py frontend
RUN python generate_formula_workbenches.py --check
RUN python validate_formula_workbenches.py /build
RUN python validate_tools.py frontend
RUN python validate_generated_conversions.py /build
RUN python validate_tool_design.py frontend
RUN python validate_risk_policy.py /build
RUN python scripts/validate_browser_security.py
# Source pages remain in Git, while the disposable runtime tree excludes every
# explicit unlisted and redirect-source page. Exact nginx redirects still work.
RUN python prune_deploy_tree.py /build
RUN python generate_seo.py frontend https://virt.tools
RUN sh generate_sitemap.sh frontend https://virt.tools
RUN python prune_deploy_tree.py /build --finalize-assets
# Query versions are deterministic: identical assets produce identical URLs.
# An explicit ASSET_VERSION may be supplied by a release system, but timestamps
# are deliberately avoided so reproducible builds do not invalidate caches.
RUN set -eu; \
    if [ -n "$ASSET_VERSION" ]; then \
      VERSION="$ASSET_VERSION"; \
    else \
      VERSION="$({ \
        find /build/frontend/assets /build/frontend/vendor /build/frontend/service-worker.js \
          -type f \( -name '*.js' -o -name '*.css' -o -name '*.wasm' \); \
        printf '%s\n' /build/frontend/index.html /build/frontend/privacy/index.html \
          /build/frontend/manifest.webmanifest /build/frontend/favicon.svg; \
        } | sort -u | xargs sha256sum | sha256sum | cut -c1-16)"; \
    fi; \
    echo "$VERSION" | grep -Eq '^[A-Za-z0-9._-]{8,64}$'; \
    find /build/frontend -type f -name '*.html' \
      -exec sed -i -E "s#((assets|vendor)/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*\.(js|css|wasm))([\"'])#\1?v=$VERSION\5#g" {} \;; \
    sed -i "s/__VT_ASSET_VERSION__/$VERSION/g" /build/frontend/service-worker.js; \
    grep -Eq "assets/[A-Za-z0-9_.-]+\.(js|css)\\?v=$VERSION" /build/frontend/index.html; \
    grep -Fq "/assets/formula-workbench.js?v=$VERSION" /build/frontend/tools/geometry-formula-workbench/index.html; \
    grep -Fq "/assets/formula-workbenches/geometry-formula-workbench.js?v=$VERSION" /build/frontend/tools/geometry-formula-workbench/index.html; \
    grep -Fq "var VERSION = \"$VERSION\"" /build/frontend/service-worker.js

FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6

# Apply the release branch's package security fixes, then drop root for runtime.
USER 0
RUN apk upgrade --no-cache

COPY --from=seo --chown=101:101 /build/frontend/ /usr/share/nginx/html/
COPY --chown=101:101 nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY --chown=101:101 nginx/tool-redirects.conf /etc/nginx/tool-redirects.conf

USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=4 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/api/live"]
