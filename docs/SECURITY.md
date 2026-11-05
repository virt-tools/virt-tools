# Security policy

## Reporting a vulnerability

This site runs calculators entirely in the browser plus one small anonymous
feedback service. If you believe you found a security issue, please do not open
a public issue with exploit details. Use the feedback form at
<https://virt.tools/feedback/> with the kind set to `bug`, and include a minimal
reproduction. Submissions are anonymous; the UUID returned at submit time is the
only way to check for a reply.

Please include:

- the affected route or API endpoint;
- the browser and version;
- what you expected and what happened;
- whether user data or another visitor's data could be exposed.

## Scope and expectations

- Client-side calculators are in scope: script injection, unsafe URL handling,
  and anything that would send tool input off the device.
- The feedback API is in scope: authorization bypass on UUID lookups, rate-limit
  bypass, and SQL injection.
- Reports are acknowledged through the feedback thread, not by email, because no
  personal contact details are collected.
- Only the latest deployed release is supported.

## Out of scope

- Automated scanner output without a demonstrated impact.
- Missing hardening headers on non-production deployments.
- Denial-of-service volume attacks against the host.
