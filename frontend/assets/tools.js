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
 *   added       — ISO 8601 timestamp the tool was first added. Drives the
 *                 "Recently added" tab on the homepage. Use the first commit
 *                 date of the tool's folder (git log --diff-filter=A).
 */
window.VIRTUAL_TOOLS = [
  {
    slug: "qr-generator",
    name: "QR Code Generator",
    description: "Generate QR codes from text or URLs — entirely in your browser.",
    category: "Encoding",
    icon: "🔳",
    added: "2026-07-03T03:27:17Z",
  },
  {
    slug: "color-converter",
    name: "Color Converter",
    description: "Convert colors between HEX, RGB and HSL with a live preview.",
    category: "Design",
    icon: "🎨",
    added: "2026-07-03T03:27:17Z",
  },
  {
    slug: "base64",
    name: "Base64 Encode / Decode",
    description: "Encode text to Base64 or decode it back. Runs locally, nothing sent anywhere.",
    category: "Encoding",
    icon: "🔣",
    added: "2026-07-03T03:27:17Z",
  },
  {
    slug: "url-encoder",
    name: "URL Encode / Decode",
    description: "Percent-encode or decode URLs and query parameters.",
    category: "Encoding",
    icon: "🔗",
    added: "2026-07-03T03:27:17Z",
  },
  {
    slug: "password-generator",
    name: "Password Generator",
    description: "Generate strong, random passwords with the Web Crypto API — nothing leaves your browser.",
    category: "Security",
    icon: "🔐",
    added: "2026-07-03T03:27:17Z",
  },
  {
    slug: "hash-generator",
    name: "Hash Generator",
    description: "Compute SHA-1 / SHA-256 / SHA-384 / SHA-512 hashes of text, in-browser via Web Crypto.",
    category: "Security",
    icon: "#️⃣",
    added: "2026-07-03T03:55:07Z",
  },
  {
    slug: "json-formatter",
    name: "JSON Formatter",
    description: "Pretty-print, minify and validate JSON — parsed locally, nothing uploaded.",
    category: "Text",
    icon: "🧩",
    added: "2026-07-03T04:05:18Z",
  },
  {
    slug: "timestamp-converter",
    name: "Unix Timestamp Converter",
    description: "Convert between Unix epoch timestamps and human-readable UTC / local dates.",
    category: "Time",
    icon: "⏱️",
    added: "2026-07-03T04:15:29Z",
  },
  {
    slug: "case-converter",
    name: "Case & Text Transform",
    description: "Convert text between cases (camelCase, snake_case, kebab, Title…) and clean up whitespace.",
    category: "Text",
    icon: "🔤",
    added: "2026-07-03T04:25:40Z",
  },
  {
    slug: "uuid-generator",
    name: "UUID Generator",
    description: "Generate RFC 4122 v4 UUIDs with crypto.randomUUID — bulk, uppercase, with or without hyphens.",
    category: "Security",
    icon: "🆔",
    added: "2026-07-03T04:45:03Z",
  },
  {
    slug: "gradient-generator",
    name: "CSS Gradient Generator",
    description: "Build linear and radial CSS gradients with a live preview and copy-ready CSS.",
    category: "Design",
    icon: "🌈",
    added: "2026-07-03T04:55:03Z",
  },
  {
    slug: "regex-tester",
    name: "Regex Tester",
    description: "Build and test JavaScript regular expressions — live matches, capture groups and flags, in-browser.",
    category: "Text",
    icon: "🔍",
    added: "2026-07-03T05:14:58Z",
  },
  {
    slug: "jwt-decoder",
    name: "JWT Decoder",
    description: "Decode a JSON Web Token's header and payload claims locally — inspect iat/exp/nbf without sending it anywhere.",
    category: "Security",
    icon: "🔑",
    added: "2026-07-03T05:21:11Z",
  },
  {
    slug: "contrast-checker",
    name: "Color Contrast Checker",
    description: "Measure the WCAG contrast ratio between two colors and check AA / AAA pass for normal and large text.",
    category: "Design",
    icon: "🅰️",
    added: "2026-07-03T05:32:30Z",
  },
  {
    slug: "markdown-previewer",
    name: "Markdown Previewer",
    description: "Write Markdown and see it rendered live — headings, bold/italic, code, lists and links, all in-browser.",
    category: "Text",
    icon: "📝",
    added: "2026-07-03T05:43:52Z",
  },
  {
    slug: "emoji-generator",
    name: "Emoji String Generator",
    description: "Generate a string of a given length made entirely of random emojis — choose which families to draw from.",
    category: "Text",
    icon: "🎲",
    added: "2026-07-03T05:52:16Z",
  },
  {
    slug: "base-converter",
    name: "Number Base Converter",
    description: "Convert integers between binary, octal, decimal, hexadecimal and any base from 2 to 36 — live, in-browser.",
    category: "Math",
    icon: "🔢",
    added: "2026-07-03T06:01:55Z",
  },
  {
    slug: "css-unit-converter",
    name: "CSS Unit Converter",
    description: "Convert a length between px, rem, em, pt, in, cm, %, vw and vh with configurable font-size and viewport references.",
    category: "Design",
    icon: "📐",
    added: "2026-07-03T06:11:19Z",
  },
  {
    slug: "word-counter",
    name: "Word & Character Counter",
    description: "Live text statistics — characters, words, sentences, paragraphs, lines, reading time and longest word.",
    category: "Text",
    icon: "✍️",
    added: "2026-07-03T06:43:16Z",
  },
];