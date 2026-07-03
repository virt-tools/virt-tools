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
  {
    slug: "uuid-generator",
    name: "UUID Generator",
    description: "Generate RFC 4122 v4 UUIDs with crypto.randomUUID — bulk, uppercase, with or without hyphens.",
    category: "Security",
    icon: "🆔",
  },
  {
    slug: "gradient-generator",
    name: "CSS Gradient Generator",
    description: "Build linear and radial CSS gradients with a live preview and copy-ready CSS.",
    category: "Design",
    icon: "🌈",
  },
  {
    slug: "contrast-checker",
    name: "Color Contrast Checker",
    description: "Measure the WCAG contrast ratio between two colors and check AA / AAA pass for normal and large text.",
    category: "Design",
    icon: "🅰️",
  },
  {
    slug: "regex-tester",
    name: "Regex Tester",
    description: "Build and test JavaScript regular expressions — live matches, capture groups and flags, in-browser.",
    category: "Text",
    icon: "🔍",
  },
  {
    slug: "markdown-previewer",
    name: "Markdown Previewer",
    description: "Write Markdown and see it rendered live — headings, bold/italic, code, lists and links, all in-browser.",
    category: "Text",
    icon: "📝",
  },
  {
    slug: "jwt-decoder",
    name: "JWT Decoder",
    description: "Decode a JSON Web Token's header and payload claims locally — inspect iat/exp/nbf without sending it anywhere.",
    category: "Security",
    icon: "🔑",
  },
  {
    slug: "emoji-generator",
    name: "Emoji String Generator",
    description: "Generate a string of a given length made entirely of random emojis — choose which families to draw from.",
    category: "Text",
    icon: "🎲",
  },
  {
    slug: "base-converter",
    name: "Number Base Converter",
    description: "Convert integers between binary, octal, decimal, hexadecimal and any base from 2 to 36 — live, in-browser.",
    category: "Math",
    icon: "🔢",
  },
];