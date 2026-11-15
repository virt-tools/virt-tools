#!/usr/bin/env python3
"""Extraction, hashing and rendering for the virt-tools i18n pipeline.

Copy on this site lives in three places: block elements (paragraphs, notes,
labels), a handful of translatable attributes, and string literals inside each
page's inline script (the calculator core builds its own rows and error text).
None of it has stable keys, so a translation unit is identified by its exact
English source text.

Units are taken at block granularity: a paragraph that wraps ``<b>``/``<code>``
inline markup becomes one whole unit with the markup embedded, because splitting
it into "Alcohol by volume from the" + "simple" + "estimate" cannot survive
translation into a language with different word order. Elements that contain a
form control, image or SVG fall back to per-text-node units so a control is never
swallowed by a translation.

CLI:
  i18n_lib.py extract <page.html>   print units as a JSON translation skeleton
  i18n_lib.py hash <page.html>      print the page's source hash
"""

from __future__ import annotations

import hashlib
import html as html_module
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

BLOCK_TAGS = {
    "p", "li", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "title",
    "td", "th", "caption", "figcaption", "summary", "option", "label",
    "blockquote", "legend", "button", "a",
}
CONTROL_TAGS = {"input", "select", "textarea", "button", "svg", "img", "canvas", "video", "audio", "iframe", "object"}
RAW_TAGS = {"script", "style", "#comment"}
# JSON-LD and import maps are generated metadata, never copy. Data blocks with
# any other type are translatable: several generated converter pages keep their
# user-visible unit labels in a <script type="application/json"> table.
NON_COPY_SCRIPT_TYPES = {"application/ld+json", "application/json+ld", "importmap", "application/importmap"}
VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
TRANSLATABLE_ATTRS = ("placeholder", "aria-label", "title", "alt")
CODE_SMELL = re.compile(r"[{}<>=;]|function\s|return\s|\bvar\s|\blet\s|\bconst\s|addEventListener|innerHTML|textContent")
# CSS values, font stacks and URLs leak into the script-literal pass; a
# translator must never see them, and an untranslated "unit" would otherwise
# block a page from publishing because coverage is all-or-nothing.
MARKUP_RE = re.compile(r"<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>")
NOT_COPY = re.compile(r"\b\d+(?:\.\d+)?px\b|var\(--|https?://|^#[0-9a-fA-F]{3,8}$|\bmonospace\b|\bsans-serif\b")
NOT_PROSE = re.compile(r"^[\w.\-/:@#%()\[\]<>+=*|&^$!?~`\\\s]+$")


class Node:
    __slots__ = ("tag", "attrs", "children", "raw", "void", "foreign")

    def __init__(self, tag: str, attrs=None, void: bool = False, foreign: bool = False):
        self.tag = tag
        self.attrs = list(attrs or [])
        self.children: list = []
        self.raw: str | None = None
        self.void = void
        self.foreign = foreign


RAW_ATTR_RE = re.compile(r"""([^\s=/>"']+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""")


def raw_attr_names(raw_tag: str) -> list[str]:
    """Attribute names with their original case, in source order.

    HTMLParser lowercases attribute names, which silently breaks SVG
    (``viewBox``, ``preserveAspectRatio``). Values still come from the parser so
    character references stay decoded; only the casing is taken from the source.
    """
    head = raw_tag[1:].rstrip(">")
    head = re.sub(r"^[^\s]+", "", head)
    return [match.group(1) for match in RAW_ATTR_RE.finditer(head)]


class Builder(HTMLParser):
    """Build a light element tree while preserving raw script/style content."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("#document")
        self.stack = [self.root]
        self.pending_doctype = ""
        self._raw: Node | None = None
        self._raw_parts: list[str] = []

    def handle_decl(self, decl: str) -> None:
        self.pending_doctype = "<!" + decl + ">"

    def handle_comment(self, data: str) -> None:
        # A comment is markup, not copy: the generated CSP/SEO blocks carry
        # sentences that must never be offered to a translator.
        node = Node("#comment")
        node.raw = "<!--" + data + "-->"
        self.stack[-1].children.append(node)

    def _pairs(self, attrs) -> list[tuple[str, str | None]]:
        names = raw_attr_names(self.get_starttag_text() or "")
        pairs = [(k, v) for k, v in attrs]
        if len(names) == len(pairs):
            pairs = [(names[index], value) for index, (_, value) in enumerate(pairs)]
        return pairs

    def _foreign(self, tag: str) -> bool:
        if tag in {"svg", "math"}:
            return True
        return any(node.foreign for node in self.stack)

    def handle_starttag(self, tag: str, attrs) -> None:
        node = Node(tag, self._pairs(attrs), void=tag in VOID_TAGS, foreign=self._foreign(tag))
        self.stack[-1].children.append(node)
        if tag in RAW_TAGS:
            self._raw = node
            self._raw_parts = []
            return
        if tag not in VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs) -> None:
        node = Node(tag, self._pairs(attrs), void=True, foreign=self._foreign(tag))
        self.stack[-1].children.append(node)

    def handle_data(self, data: str) -> None:
        if self._raw is not None:
            self._raw_parts.append(data)
            return
        self.stack[-1].children.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in RAW_TAGS and self._raw is not None:
            self._raw.raw = "".join(self._raw_parts)
            self._raw = None
            self._raw_parts = []
            if tag not in VOID_TAGS and len(self.stack) > 1 and self.stack[-1].tag == tag:
                self.stack.pop()
            return
        if tag in VOID_TAGS:
            return
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return
        # Browsers drop a stray end tag instead of failing the document, and a
        # few hand-written pages carry one. Mirroring that keeps the pipeline
        # working on the corpus while validate_tool_design.py owns the stricter
        # malformed-markup gate.


def parse(text: str) -> tuple[Node, str]:
    builder = Builder()
    builder.feed(text)
    builder.close()
    return builder.root, builder.pending_doctype


def norm_ws(value: str) -> str:
    """Collapse runs of whitespace, keeping inline markup intact."""
    return re.sub(r"\s+", " ", value).strip()


def norm_inner(value: str) -> str:
    """Collapse whitespace but keep one separating space at each edge.

    Stripping inside a unit would glue ``the<b>simple</b>estimate`` together, so
    only the outermost unit string is trimmed.
    """
    return re.sub(r"\s+", " ", value)


def escape_text(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def escape_attr(value: str, quote: str) -> str:
    out = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return out.replace('"', "&quot;") if quote == '"' else out.replace("'", "&#39;")


def serialize(node: Node | str, normalize: bool = True) -> str:
    if isinstance(node, str):
        # Text is stored decoded; writing it back without escaping turns
        # ``&lt;table&gt;`` shown as code into a real element.
        return escape_text(norm_inner(node) if normalize else node)
    if node.tag == "#comment":
        return node.raw or ""
    attrs = ""
    for key, value in node.attrs:
        if value is None:
            attrs += " " + key
        else:
            quote = '"'
            attrs += " " + key + "=" + quote + escape_attr(value, quote) + quote
    if node.raw is not None:
        return f"<{node.tag}{attrs}>{node.raw}</{node.tag}>"
    if node.void:
        # Self-closing syntax is required inside SVG; it is optional in HTML.
        return f"<{node.tag}{attrs}{'/' if node.foreign else ''}>"
    inner = "".join(serialize(child, normalize) for child in node.children)
    return f"<{node.tag}{attrs}>{inner}</{node.tag}>"


def is_js_script(node: Node) -> bool:
    for key, value in node.attrs:
        if key.lower() == "type":
            return (value or "").strip().lower() not in NON_COPY_SCRIPT_TYPES
    return True


def text_of(node: Node | str) -> str:
    if isinstance(node, str):
        return node
    if node.raw is not None:
        return ""
    return "".join(text_of(child) for child in node.children)


def _has_descendant(node: Node, tags: set[str]) -> bool:
    for child in node.children:
        if isinstance(child, Node):
            if child.tag in tags or _has_descendant(child, tags):
                return True
    return False


def _collect_text_nodes(node: Node, out: list[str]) -> None:
    for child in node.children:
        if isinstance(child, str):
            value = norm_ws(child)
            if value:
                out.append(value)
        elif child.tag in RAW_TAGS:
            continue
        else:
            _collect_text_nodes(child, out)


def walk(node: Node, on_element) -> None:
    on_element(node)
    for child in node.children:
        if isinstance(child, Node):
            walk(child, on_element)


def is_prose(value: str) -> bool:
    value = norm_ws(value)
    if len(value) < 2:
        return False
    return bool(re.search(r"[A-Za-z\u00c0-\u024f\u0400-\u04ff]", value))


LETTER_RE = re.compile(r"[^\W\d_]", re.UNICODE)
# Literal fragments of an expression are not copy: ``", ]/.test(s)?'"`` is the
# tail of a template the page concatenates, and translating it would edit code.
CODE_SHAPE = re.compile(r"[\]\[`$\\]|=>|\|\||&&|\.test\(|\.replace\(|\.join\(|\.split\(|\$\{|^\s*[)\]},;:]|\s\?\s")


def is_code_shaped(text: str) -> bool:
    """True for operator soup that leaked out of a string literal."""
    compact = re.sub(r"\s+", "", text)
    letters = len(LETTER_RE.findall(compact))
    return letters / max(1, len(compact)) < 0.5 or bool(CODE_SHAPE.search(text))


def looks_prose_literal(value: str) -> bool:
    """True when a JS string literal is user-facing copy rather than a value.

    Keys, URLs, class names and format strings fail the letter/space test; the
    code-smell filter drops anything built out of operators or markup. A unit
    that turns out to be a false positive shows up as an unused translation and
    is reported rather than silently shipped.
    """
    text = norm_ws(value)
    if len(text) < 8 or " " not in text:
        return False
    if NOT_COPY.search(text):
        return False
    if not re.search(r"[A-Za-z\u00c0-\u024f]{3,}", text):
        return False
    return not CODE_SMELL.search(text) and not is_code_shaped(text)


def scan_js_literals(body: str) -> list[tuple[int, int, str, str]]:
    """Return (start, end, quote, value) for every JS string literal in source order.

    A real scanner is required: a regex alternation happily matches from the
    closing quote of one literal to the opening quote of the next, which turns
    ``" + rnd(simple, 2) + "`` into a bogus "translatable" unit.
    """
    found: list[tuple[int, int, str, str]] = []
    index, length = 0, len(body)
    while index < length:
        char = body[index]
        if char == "/" and index + 1 < length and body[index + 1] == "/":
            newline = body.find("\n", index)
            index = length if newline == -1 else newline + 1
            continue
        if char == "/" and index + 1 < length and body[index + 1] == "*":
            end = body.find("*/", index + 2)
            index = length if end == -1 else end + 2
            continue
        if char in "\"'`":
            quote = char
            start = index + 1
            cursor = start
            while cursor < length:
                if body[cursor] == "\\":
                    cursor += 2
                    continue
                if body[cursor] == quote:
                    break
                if body[cursor] == "\n":
                    break
                cursor += 1
            if cursor < length and body[cursor] == quote:
                found.append((start, cursor, quote, body[start:cursor]))
                index = cursor + 1
                continue
            index = start
            continue
        index += 1
    return found


SIMPLE_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}


def js_unescape(body: str) -> str:
    r"""Decode a JS string literal body.

    ``\uXXXX`` and ``\xNN`` are real characters: leaving the backslash out turned
    ``W/(m\u00b2\u00b7K)`` into ``W/(mu00b2u00b7K)``, which a translated page then
    printed verbatim.
    """
    out, index = [], 0
    while index < len(body):
        char = body[index]
        if char != "\\" or index + 1 >= len(body):
            out.append(char)
            index += 1
            continue
        nxt = body[index + 1]
        if nxt == "u" and index + 5 < len(body) + 1:
            chunk = body[index + 2 : index + 6]
            if re.fullmatch(r"[0-9a-fA-F]{4}", chunk):
                out.append(chr(int(chunk, 16)))
                index += 6
                continue
        if nxt == "u" and body[index + 2 : index + 3] == "{":
            end = body.find("}", index + 3)
            chunk = body[index + 3 : end] if end != -1 else ""
            if chunk and re.fullmatch(r"[0-9a-fA-F]{1,6}", chunk):
                out.append(chr(int(chunk, 16)))
                index = end + 1
                continue
        if nxt == "x":
            chunk = body[index + 2 : index + 4]
            if re.fullmatch(r"[0-9a-fA-F]{2}", chunk):
                out.append(chr(int(chunk, 16)))
                index += 4
                continue
        out.append(SIMPLE_ESCAPES.get(nxt, nxt))
        index += 2
    return "".join(out)


def js_escape(value: str, quote: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r")
    return escaped.replace(quote, "\\" + quote)


def direct_text(node: Node) -> list[str]:
    """Normalized text of an element's own text children (not its descendants)."""
    return [norm_ws(child) for child in node.children if isinstance(child, str) and norm_ws(child)]


def fragment_units(value: str) -> list[str]:
    """Prose text inside a JS string that builds markup for innerHTML.

    The page's calculator core writes its empty state and result rows as HTML
    templates, so the copy lives inside a literal that also carries tags and
    inline styles. Those literals are rejected as whole units, but their text is
    the same text the markup shows, so it translates once and both surfaces agree.
    """
    if not MARKUP_RE.search(value):
        return []
    root, _ = parse(value)
    found: list[str] = []
    _collect_text_nodes(root, found)
    return [unit for unit in found if is_prose(unit) and not is_code_shaped(unit)]


def extract_units(root: Node) -> dict:
    """Collect units by kind, in document order, preserving first-seen order."""
    html_units: dict[str, None] = {}
    text_units: dict[str, None] = {}
    attr_units: dict[str, None] = {}
    js_units: dict[str, None] = {}

    def collect_attrs(node: Node) -> None:
        """Attributes of a subtree whose text is already covered by a block unit.

        A ``<label>Custom names <textarea placeholder="...">`` label is taken as
        one text unit, so the walker used to stop at the label and never see the
        control's placeholder or aria-label. Those are visible copy too.
        """
        for key, value in node.attrs:
            if key.lower() in TRANSLATABLE_ATTRS and value:
                unit = norm_ws(html_module.unescape(value))
                if is_prose(unit):
                    attr_units.setdefault(unit, None)
        for child in node.children:
            if isinstance(child, Node):
                collect_attrs(child)

    def visit(node: Node) -> None:
        if node.tag in RAW_TAGS:
            if node.tag == "script" and node.raw and is_js_script(node):
                for _, _, _, value in scan_js_literals(node.raw):
                    unit = norm_ws(js_unescape(value))
                    if looks_prose_literal(unit):
                        js_units.setdefault(unit, None)
                        continue
                    for nested in fragment_units(js_unescape(value)):
                        js_units.setdefault(nested, None)
            return
        for key, value in node.attrs:
            if key.lower() in TRANSLATABLE_ATTRS and value:
                unit = norm_ws(html_module.unescape(value))
                if is_prose(unit):
                    attr_units.setdefault(unit, None)
        if node.tag in BLOCK_TAGS and not _has_descendant(node, BLOCK_TAGS):
            if node.tag in CONTROL_TAGS or _has_descendant(node, CONTROL_TAGS) or any(
                isinstance(child, Node) and child.tag in CONTROL_TAGS for child in node.children
            ):
                found: list[str] = []
                _collect_text_nodes(node, found)
                for unit in found:
                    if is_prose(unit):
                        text_units.setdefault(unit, None)
                collect_attrs(node)
                return
            inner = norm_ws("".join(serialize(child) for child in node.children))
            if inner and is_prose(re.sub(r"<[^>]*>", " ", inner)):
                # A block with no inline markup is plain text: key it as the text a
                # user reads (``A & B``), not as escaped HTML (``A &amp; B``), so a
                # translator never has to produce entities.
                key = html_module.unescape(inner) if "<" not in inner else inner
                html_units.setdefault(key, None)
                collect_attrs(node)
                return
        # Text that no block unit covers: a stray label in a wrapper element, or
        # text beside nested blocks such as the "Sort" label next to its buttons.
        for unit in direct_text(node):
            if is_prose(unit):
                text_units.setdefault(unit, None)
        for child in node.children:
            if isinstance(child, Node):
                visit(child)

    visit(root)
    return {"html": html_units, "text": text_units, "attrs": attr_units, "js": js_units}


def units(document: dict) -> list[str]:
    ordered: dict[str, None] = {}
    for kind in ("html", "attrs", "text", "js"):
        for key in document.get(kind, {}):
            ordered.setdefault(key, None)
    return list(ordered)


def source_hash(document: dict) -> str:
    digest = hashlib.sha256()
    for unit in sorted(set(units(document))):
        digest.update(unit.encode("utf-8"))
        digest.update(b"\n")
    return "sha256:" + digest.hexdigest()


def _fragment(value: str) -> list:
    root, _ = parse(value)
    return list(root.children)


def _replace_direct_text(node: Node, mapping: dict, applied: set[str]) -> None:
    for index, child in enumerate(node.children):
        if not isinstance(child, str):
            continue
        key = norm_ws(child)
        if key not in mapping:
            continue
        applied.add(key)
        # Keep the original leading/trailing whitespace: dropping it would glue
        # the translated words to the neighbouring inline elements.
        lead = child[: len(child) - len(child.lstrip())]
        trail = child[len(child.rstrip()):]
        node.children[index] = lead + escape_text(mapping[key]) + trail


def attr_units(node: Node) -> set[str]:
    """Translatable attribute units inside a subtree."""
    found: set[str] = set()
    for key, value in node.attrs:
        if value and key.lower() in TRANSLATABLE_ATTRS:
            unit = norm_ws(html_module.unescape(value))
            if unit:
                found.add(unit)
    for child in node.children:
        if isinstance(child, Node):
            found |= attr_units(child)
    return found


def apply_attrs(node: Node, mapping: dict, applied: set[str]) -> None:
    """Translate translatable attributes across a subtree."""
    if node.attrs:
        rewritten = []
        for key, value in node.attrs:
            if value and key.lower() in TRANSLATABLE_ATTRS:
                unit = norm_ws(html_module.unescape(value))
                if unit in mapping:
                    applied.add(unit)
                    rewritten.append((key, mapping[unit]))
                    continue
            rewritten.append((key, value))
        node.attrs = rewritten
    for child in node.children:
        if isinstance(child, Node):
            apply_attrs(child, mapping, applied)


TAG_SPLIT_RE = re.compile(r"(<[^>]*>)")
ATTR_IN_TAG_RE = re.compile(r"""([^\s=<>"']+)(\s*=\s*)(?:"([^"]*)"|'([^']*)')""")


def translate_markup_literal(value: str, mapping: dict, applied: set[str]) -> str | None:
    """Translate text and attributes inside a JS string that builds markup.

    Byte-preserving by design: only text between tags and translatable attribute
    values are rewritten, so a literal that holds half a tag survives intact.
    """
    changed = False
    out: list[str] = []
    for part in TAG_SPLIT_RE.split(value):
        if not part:
            continue
        if part.startswith("<") and part.endswith(">"):
            def rewrite_attr(match: re.Match) -> str:
                nonlocal changed
                name, separator, double, single = match.group(1), match.group(2), match.group(3), match.group(4)
                if name.lower() not in TRANSLATABLE_ATTRS:
                    return match.group(0)
                raw = double if double is not None else single
                unit = norm_ws(html_module.unescape(raw))
                if not unit or unit not in mapping:
                    return match.group(0)
                applied.add(unit)
                changed = True
                quote = '"' if double is not None else "'"
                return f"{name}{separator}{quote}{escape_attr(mapping[unit], quote)}{quote}"
            out.append(ATTR_IN_TAG_RE.sub(rewrite_attr, part))
            continue
        lead = part[: len(part) - len(part.lstrip())]
        trail = part[len(part.rstrip()):]
        unit = html_module.unescape(norm_ws(part))
        if unit and unit in mapping:
            applied.add(unit)
            changed = True
            out.append(lead + escape_text(mapping[unit]) + trail)
        else:
            out.append(part)
    return "".join(out) if changed else None


def apply_translation(root: Node, mapping: dict) -> set[str]:
    """Rewrite a parsed page in place; return the set of keys actually used."""
    applied: set[str] = set()

    def visit(node: Node) -> None:
        if node.tag in RAW_TAGS:
            if node.tag == "script" and node.raw and is_js_script(node):
                body = node.raw
                literals = scan_js_literals(body)
                pieces, cursor = [], 0
                for start, end, quote, value in literals:
                    key = norm_ws(js_unescape(value))
                    if key in mapping:
                        applied.add(key)
                        pieces.append(body[cursor:start])
                        pieces.append(js_escape(mapping[key], quote))
                        cursor = end
                        continue
                    if MARKUP_RE.search(value):
                        # Replace text and attributes in place. Parsing the literal
                        # and re-serialising it repairs tags that the page splits
                        # across concatenation (``"<span class='v'>" + n + "</span>"``)
                        # and turns a template into broken markup.
                        rendered = translate_markup_literal(js_unescape(value), mapping, applied)
                        if rendered is not None:
                            pieces.append(body[cursor:start])
                            pieces.append(js_escape(rendered, quote))
                            cursor = end
                if pieces:
                    pieces.append(body[cursor:])
                    node.raw = "".join(pieces)
            return
        if node.attrs:
            rewritten = []
            for key, value in node.attrs:
                if value and key.lower() in TRANSLATABLE_ATTRS:
                    unit = norm_ws(html_module.unescape(value))
                    if unit in mapping:
                        applied.add(unit)
                        rewritten.append((key, mapping[unit]))
                        continue
                rewritten.append((key, value))
            node.attrs = rewritten
        if node.tag in BLOCK_TAGS and not _has_descendant(node, BLOCK_TAGS):
            has_control = node.tag in CONTROL_TAGS or _has_descendant(node, CONTROL_TAGS) or any(
                isinstance(child, Node) and child.tag in CONTROL_TAGS for child in node.children
            )
            inner = norm_ws("".join(serialize(child) for child in node.children))
            if not has_control and inner in mapping:
                # The block is replaced as a whole, so any attribute unit it
                # contains is covered by that replacement even when the
                # translator already rendered the attribute itself.
                applied.update(attr_units(node) & set(mapping))
                applied.add(inner)
                node.children = _fragment(mapping[inner])
                # The translated block carries its own markup, so the walker never
                # reaches the attributes inside it (``<span aria-label="Actions">``).
                # Apply attribute units there too, or that copy stays English and
                # the attribute unit is reported unused.
                for child in node.children:
                    if isinstance(child, Node):
                        apply_attrs(child, mapping, applied)
                return
        _replace_direct_text(node, mapping, applied)
        for child in node.children:
            if isinstance(child, Node):
                visit(child)

    visit(root)
    return applied


def render(text: str, mapping: dict) -> tuple[str, set[str], set[str]]:
    """Translate a page source; return (html, applied_keys, unused_keys)."""
    root, doctype = parse(text)
    applied = apply_translation(root, mapping)
    out = (doctype if doctype else "") + "".join(serialize(child, normalize=False) for child in root.children)
    return out, applied, set(mapping) - applied


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_registry(data_dir: Path) -> dict:
    registry = load_json(data_dir / "i18n" / "locales.json")
    codes = [entry["code"] for entry in registry["locales"]]
    if registry.get("default") not in codes:
        raise ValueError("i18n registry default locale is not listed")
    if len(set(codes)) != len(codes):
        raise ValueError("i18n registry repeats a locale code")
    for entry in registry["locales"]:
        if entry.get("dir", "ltr") not in {"ltr", "rtl"}:
            raise ValueError(f"locale {entry['code']}: dir must be ltr or rtl")
    return registry


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] not in {"extract", "hash"}:
        print("usage: i18n_lib.py extract|hash <page.html>", file=sys.stderr)
        return 2
    text = Path(argv[2]).read_text(encoding="utf-8")
    root, _ = parse(text)
    document = extract_units(root)
    if argv[1] == "hash":
        print(source_hash(document))
        return 0
    print(json.dumps({
        "sourceHash": source_hash(document),
        "counts": {kind: len(items) for kind, items in document.items()},
        "strings": {unit: "" for unit in units(document)},
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
