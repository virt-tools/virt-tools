/*
 * Virtual Tools — tool registry.
 *
 * To add a new tool:
 *   1. Create frontend/tools/<slug>/index.html  (copy an existing tool as a starting point).
 *   2. Add an entry below.
 * The homepage catalog and navigation are generated from this list automatically,
 * so no other wiring is required.
 *
 * Fields:
 *   slug        — folder name under frontend/tools/ (used in the URL: /tools/<slug>/)
 *   name        — display name
 *   description — one-line summary shown on the catalog card
 *   category    — grouping label on the homepage
 *   icon        — emoji shown on the card
 */
window.VIRTUAL_TOOLS = [
  {
    slug: "qr-generator",
    name: "QR Code Generator",
    description: "Generate QR codes from text or URLs — entirely in your browser.",
    category: "Encoding",
    icon: "🔳",
  },
  {
    slug: "color-converter",
    name: "Color Converter",
    description: "Convert colors between HEX, RGB and HSL with a live preview.",
    category: "Design",
    icon: "🎨",
  },
  {
    slug: "base64",
    name: "Base64 Encode / Decode",
    description: "Encode text to Base64 or decode it back. Runs locally, nothing sent anywhere.",
    category: "Encoding",
    icon: "🔣",
  },
  {
    slug: "url-encoder",
    name: "URL Encode / Decode",
    description: "Percent-encode or decode URLs and query parameters.",
    category: "Encoding",
    icon: "🔗",
  },
  {
    slug: "password-generator",
    name: "Password Generator",
    description: "Generate strong, random passwords with the Web Crypto API — nothing leaves your browser.",
    category: "Security",
    icon: "🔐",
  },
  {
    slug: "hash-generator",
    name: "Hash Generator",
    description: "Compute SHA-1 / SHA-256 / SHA-384 / SHA-512 hashes of text, in-browser via Web Crypto.",
    category: "Security",
    icon: "#️⃣",
  },
  {
    slug: "json-formatter",
    name: "JSON Formatter",
    description: "Pretty-print, minify and validate JSON — parsed locally, nothing uploaded.",
    category: "Text",
    icon: "🧩",
  },
  {
    slug: "timestamp-converter",
    name: "Unix Timestamp Converter",
    description: "Convert between Unix epoch timestamps and human-readable UTC / local dates.",
    category: "Time",
    icon: "⏱️",
  },
  {
    slug: "case-converter",
    name: "Case & Text Transform",
    description: "Convert text between cases (camelCase, snake_case, kebab, Title…) and clean up whitespace.",
    category: "Text",
    icon: "🔤",
  },
];