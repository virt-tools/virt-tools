#!/usr/bin/env python3
"""Validate the canonical tool catalog and generate its browser artifact.

``frontend/assets/tool-catalog.json`` is the source of truth.  The generated
``tools.js`` file exists only because the static homepage must work without a
build-time module loader.  Generation always applies the curation policy, so a
tool named by ``tool-curation.json`` cannot be accidentally re-listed.

The legacy importer is intentionally opt-in and exists only for the one-time
migration from the former JavaScript registry.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


CATALOG_FILENAME = "tool-catalog.json"
GENERATED_FILENAME = "tools.js"
METADATA_DIRNAME = "tool-meta"
SCHEMA_VERSION = 1
RISK_VALUES = {"unknown", "low", "moderate", "high", "critical"}
MATURITY_VALUES = {"unreviewed", "draft", "reviewed", "verified", "deprecated"}
PUBLIC_GUIDANCE = {
    "moderate": "Planning estimate—verify assumptions and important results before committing time or money.",
    "high": "Do not rely on this result alone. Check applicable professional guidance, codes, standards, or product instructions before acting.",
    "critical": "Do not rely on this result alone. Check applicable professional guidance, codes, standards, or product instructions before acting.",
}
PUBLIC_TOOL_GUIDANCE = {
    "physics-astronomy-workbench": "Check units, model assumptions, and authoritative reference values before using these physics or astronomy estimates beyond exploration.",
    "finance-formula-workbench": "Financial planning estimate—verify rates, timing, fees, taxes, and contract terms before making a financial commitment.",
    "construction-materials-workbench": "Construction planning estimate—verify measurements, waste assumptions, product instructions, and local requirements before purchasing or building.",
    "workshop-crafts-workbench": "Workshop planning estimate—verify dimensions, material behavior, machine setup, and project-specific tolerances before cutting or fabrication.",
    "recreation-formula-workbench": "Recreation planning estimate—check equipment instructions, conditions, and appropriate safety guidance before relying on a result outdoors or during an activity.",
    "environment-fluid-workbench": "Environmental and fluid estimate—verify site conditions, units, model assumptions, and applicable technical guidance before design or operational use.",
}
PUBLIC_CATEGORY_GUIDANCE = {
    "Finance": "Financial estimate—verify rates, fees, taxes, timing, and contract terms; seek qualified advice for consequential decisions.",
    "Health": "General informational estimate—not medical advice. Check authoritative health guidance and consult a qualified professional when decisions affect care.",
    "Construction": "Planning estimate—verify measurements, product instructions, local requirements, and qualified design before purchasing or building.",
    "Electrical & Energy": "Electrical planning aid—verify equipment data, applicable codes, and the design with a qualified electrician or engineer before installation.",
    "Civil & Geotechnical Engineering": "Preliminary engineering estimate—verify site data, governing standards, and calculations with a qualified engineer before design or construction.",
    "Mechanical & Structural Engineering": "Preliminary engineering estimate—verify loads, materials, governing standards, and calculations with a qualified engineer before fabrication or construction.",
    "Oil, Gas & Marine Engineering": "Preliminary industrial estimate—verify process and site data, governing standards, and calculations through qualified engineering review before operational use.",
    "Home Systems": "Planning estimate—verify equipment instructions, local requirements, and qualified trade guidance before installation or adjustment.",
    "Safety & Emergency": "Do not use this tool as the sole basis for protective or emergency decisions. Follow current authoritative procedures and qualified guidance.",
    "Food": "This result does not establish food safety. Follow a current tested process, product directions, and authoritative food-safety guidance.",
    "Security": "Security aid—validate the result in a controlled environment and against current authoritative guidance before protecting a real system or secret.",
    "Geography": "Planning estimate—not a substitute for authoritative surveying, legal boundary, navigation, or emergency-location data.",
    "Communications Engineering": "Engineering estimate—verify equipment limits, spectrum rules, site conditions, and calculations before deployment.",
    "Sports & Outdoors": "Planning estimate—check conditions, equipment instructions, and appropriate qualified safety guidance before an activity.",
}
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
LEGACY_OBJECT_RE = re.compile(r"^  \{\n(.*?)^  \},\n", re.MULTILINE | re.DOTALL)
LEGACY_FIELD_RE = re.compile(r'^    ([A-Za-z_]\w*):\s*("(?:[^"\\]|\\.)*"),$', re.MULTILINE)


SUBCATEGORY_RULES = (
    ("Conversion", ("convert", "converter", "conversion", "transform")),
    ("Planning", ("planner", "planning", "schedule", "timeline", "roadmap", "calendar")),
    ("Analysis & validation", ("analyzer", "analysis", "validator", "checker", "audit", "scanner", "inspector", "tester")),
    ("Generation", ("generator", "builder", "maker", "creator")),
    ("Estimation & calculation", ("calculator", "estimate", "estimator", "forecast", "projection")),
    ("Formatting", ("formatter", "formatting", "beautifier", "minifier")),
    ("Tracking & logging", ("tracker", "tracking", "log", "journal", "counter")),
    ("Reference", ("reference", "lookup", "dictionary", "cheat sheet", "table")),
)

TAG_RULES = {
    "accessibility": ("accessibility", "a11y", "aria", "wcag"),
    "api": ("api", "graphql", "webhook", "http request"),
    "audio": ("audio", "sound", "waveform", "music"),
    "color": ("color", "colour", "palette", "contrast"),
    "css": ("css", "stylesheet", "flexbox", "grid"),
    "data": ("data", "csv", "json", "xml", "yaml", "sql"),
    "date-time": ("date", "time", "calendar", "timezone", "timestamp"),
    "developer": ("code", "developer", "programming", "regex", "git"),
    "document": ("document", "pdf", "markdown", "text", "word"),
    "finance": ("finance", "money", "loan", "interest", "mortgage", "tax", "investment"),
    "geography": ("map", "coordinate", "latitude", "longitude", "geography"),
    "health": ("health", "medical", "medication", "fitness", "body", "nutrition"),
    "image": ("image", "photo", "svg", "canvas", "pixel"),
    "network": ("network", "dns", "ip address", "subnet", "url"),
    "privacy": ("privacy", "redact", "sensitive", "secret"),
    "security": ("security", "password", "hash", "cipher", "encrypt", "certificate"),
    "unit-conversion": (" unit converter", "convert between", "conversion"),
    "video": ("video", "frame rate", "subtitle"),
}

ALIAS_RULES = {
    "color": "colour",
    "colour": "color",
    "uuid": "guid",
    "guid": "uuid",
    "javascript": "js",
    "typescript": "ts",
    "regular expression": "regex",
    "base64": "base 64",
    "url": "uri",
    "timezone": "time zone",
    "kilometre": "kilometer",
    "kilometer": "kilometre",
    "metre": "meter",
    "meter": "metre",
}

# The former Productivity category accumulated hundreds of unrelated generated
# calculators.  These ordered rules provide stable, domain-first browsing while
# ``legacyCategory`` preserves the historical classification for migration and
# analytics comparisons.
PRODUCTIVITY_DOMAIN_RULES = (
    ("Crafts & Hobbies", (
        "fabric", "button spacing", "seam allowance", "bias binding", "quilt",
        "knitting", "crochet", "potting bench",
    )),
    ("Sports & Outdoors", (
        "cycling", "bike gear", "bocce", "horseshoe", "swim lap", "playset",
    )),
    ("IT & Networking", (
        "ethernet", "network", "server rack", "data center", "patch panel", "rack u",
        "rack pdu", "fiber", "dvr", "camera", "hdmi", "projector", "av receiver",
        "smart speaker", "zigbee", "cable label", "cable management", "cold aisle",
        "raised floor tile", "ups load", "pdu outlet",
    )),
    ("Safety & Emergency", (
        "fire extinguisher", "fire blanket", "fire door", "fire stop", "fire alarm",
        "fire sprinkler", "fire pump", "fire tank", "foam system", "standpipe",
        "smoke detector", "heat detector", "duct detector", "notification appliance",
        "carbon monoxide", "co detector", "escape ladder", "emergency light", "exit sign",
        "first aid", "spill kit", "eyewash", "dust mask", "respirator", "safety glass",
        "hard hat", "ear protection", "knee pad", "back support", "harness", "high-vis",
        "traffic cone", "safety cone", "barricade", "warning sign", "channelizer",
        "arrow board", "diving board safety",
    )),
    ("Electrical & Energy", (
        "ampacity", "conduit", "junction box", "ground rod", "motor starter", "breaker",
        "solar", "battery", "inverter", "wire ", "wire nut", "voltage", "transformer",
        "generator load", "temporary power", "led heat sink", "charge controller",
        "grounding conductor", "surge protector", "transfer switch", "neutral bar",
        "terminal block", "bus bar", "lug selector", "power supply", "doorbell transformer",
        "smart light load", "speaker wire", "grid tie", "microgrid", "frequency regulation",
        "capacitor", "reactor sizing", "load tap", "fault current", "arc flash",
        "protective relay", "relay setting", "relay selector", "relay coordination",
        "ct saturation", "pt fuse", "load shed", "sync check", "recloser", "sectionalizer",
        "fuse saving", "voltage sag", "harmonic filter", "impedance compensation",
        "power factor", "load flow", "short circuit", "cable derating", "busbar",
        "wind turbine", "solar farm", "battery storage",
    )),
    ("Communications Engineering", (
        "antenna", "free space path loss", "link budget", "noise figure", "snr",
        "bandwidth", "modulation", "baud rate", "channel capacity", "coding gain",
        "satellite eirp", "rain attenuation", "fresnel zone", "swr calculator",
    )),
    ("Home Systems", (
        "hvac", "duct", "refrigerant", "btu heating", "btu cooling", "humidifier",
        "dehumidifier", "air filter", "fan cfm", "static pressure", "damper", "vav",
        "erv", "hrv", "condensate", "chiller", "boiler", "cooling tower", "heat pump",
        "radiant floor", "baseboard heat", "water softener", "well pump", "septic",
        "grease trap", "backflow", "water heater", "expansion tank", "pressure reducer",
        "water hammer", "water filtration", "gas line", "vent pipe", "exhaust flue",
        "make-up air", "combustion air", "dryer vent", "bathroom fan", "range hood",
        "kitchen exhaust", "garage ventilation", "attic fan", "crawl space ventilation",
        "radon", "sub-slab", "soil gas", "sump pump", "well pressure tank",
        "smart thermostat", "smart lock", "doorbell",
    )),
    ("Home & Garden", (
        "plant", "garden", "grass", "lawn", "soil amendment", "soil ph", "compost",
        "raised bed", "raised planter", "rain barrel", "mulch", "tree stake", "tree gauge",
        "fertilizer", "seed spread", "drip line", "soaker hose", "garden hose", "sprinkler coverage",
        "irrigation", "leaf ", "pruning", "cold frame", "greenhouse", "hoop house",
        "pool", "hot tub", "spa chemical", "saltwater generator", "sandbox", "ice rink",
        "firewood", "sunlight hours", "water tank", "pebble coverage",
    )),
    ("Civil & Geotechnical Engineering", (
        "bearing capacity", "soil bearing", "foundation settlement", "slope stability",
        "pile capacity", "excavation support", "soil nail", "settlement plate", "dewatering well",
        "compaction curve", "proctor", "cbr", "liquid limit", "plastic limit", "atterberg",
        "sieve analysis", "hydrometer", "direct shear", "triaxial", "unconfined compression",
        "moisture density", "consolidation test", "swell test", "permeability", "sand cone",
        "nuclear density", "shelby tube", "penetration test", "field vane", "pressuremeter",
        "plate load", "cone penetration", "dilatometer", "borehole", "cross-hole", "downhole",
        "parallel seismic", "suspension logging", "surface wave", "refraction seismic",
        "reflection seismic", "masw", "remi", "electrical resistivity", "induced polarization",
        "spontaneous potential", "ground penetrating radar", "magnetic survey", "gravity survey",
        "radiometric survey", "thermal infrared", "density logging", "neutron logging",
        "gamma-ray", "resistivity logging",
    )),
    ("Oil, Gas & Marine Engineering", (
        "cement slurry", "mud weight", "mud rheology", "annular velocity", "hydraulic fracture",
        "frac fluid", "proppant", "drill pipe", "bit hydraulics", "casing", "cement bond",
        "drill string", "hoisting load", "mud pump", "kick detection", "kill mud", "standpipe pressure",
        "hole cleaning", "tripping", "wiper trip", "liner hang", "tubing", "packer", "perforation",
        "gravel pack", "acidizing", "coiled tubing", "stimulation", "formation damage", "sand control",
        "wellhead", "gas lift", "plunger lift", "artificial lift", "rod pump", "pcp pump", "esp motor",
        "subsea", "flowline", "manifold design", "riser design", "umbilical", "flying lead",
        "topsides", "pipeline", "pig launcher", "offshore platform",
    )),
    ("Mechanical & Structural Engineering", (
        "beam ", "beam load", "column load", "corbel", "cantilever", "flitch", "bolt shear",
        "bolt tensile", "bolt capacity", "weld size", "anchor bolt", "nail withdrawal", "screw pullout",
        "timber span", "glulam", "lvl beam", "pipe hanger", "cable tray support", "ladder rack load",
        "tray ground", "tray expansion", "seismic brace", "spring hanger", "rod stiffness", "beam camber",
        "wind load panel", "snow drift", "seismic force", "lateral force", "thermal stress",
        "retaining wall stem", "basement wall", "spindle speed", "machining", "drilling feed",
        "material removal", "welding", "lathe", "tap drill", "bolt circle", "drill point", "countersink",
    )),
    ("Construction", (
        "wallpaper", "lumber", "concrete", "roof", "shingle", "paint", "tile", "drywall",
        "fence", "wall r-value", "stair", "deck", "gravel driveway", "gutter", "downspout",
        "sidewalk", "rebar", "retaining wall", "driveway", "screed", "insulation", "vapor barrier",
        "asphalt", "drainage pipe", "silt fence", "erosion blanket", "perforated pipe", "cleanout",
        "weep hole", "french drain", "cistern", "attic vent", "soffit", "ridge vent", "stud spacing",
        "joist", "rafter", "header size", "pallet", "shelf spacing", "cabinet", "countertop",
        "backsplash", "rough opening", "door swing", "baseboard", "crown molding", "wainscoting",
        "chair rail", "cable tray", "flashing", "siding", "fascia", "rake board", "window trim",
        "door casing", "base shoe", "cove molding", "panel molding", "batten", "shutter", "awning",
        "storm door", "screen door", "garage door", "attic stair", "fireplace hearth", "chimney",
        "fence post", "fence rail", "gate latch", "pergola", "arbor material", "trellis",
        "composite deck", "gazebo", "paver sand", "grout", "thinset", "mortar", "stucco", "plaster",
        "wood filler", "sanding", "steel wool", "abrasive grit", "tack cloth", "job trailer",
        "material storage", "site lighting", "crane lift", "scaffold", "shoring", "excavation",
        "trench spoil", "dewatering pump", "form tie", "form release", "post tension", "masonry",
        "brick", "stone veneer", "glass block", "cmu", "lintel", "repointing", "tuckpointing",
        "parging", "stone sill", "cast stone", "staircase", "roofing bundle", "rebar weight",
    )),
)


def has_keyword(haystack: str, keyword: str) -> bool:
    return re.search(r"(?<![a-z0-9])" + re.escape(keyword.strip()) + r"(?![a-z0-9])", haystack) is not None


def infer_domain(entry: dict[str, Any]) -> str:
    legacy = entry.get("legacyCategory") or entry.get("category")
    if legacy != "Productivity":
        return str(entry.get("category") or "Other")
    haystack = _text(entry)
    for domain, keywords in PRODUCTIVITY_DOMAIN_RULES:
        if any(has_keyword(haystack, keyword) for keyword in keywords):
            return domain
    return "Personal Productivity"


def _text(entry: dict[str, Any]) -> str:
    return " ".join(
        str(entry.get(key, "")) for key in ("name", "description", "category", "slug")
    ).casefold()


def infer_subcategory(entry: dict[str, Any]) -> str:
    haystack = _text(entry)
    for label, needles in SUBCATEGORY_RULES:
        if any(has_keyword(haystack, needle) for needle in needles):
            return label
    return "General"


def infer_tags(entry: dict[str, Any], subcategory: str) -> list[str]:
    haystack = " " + _text(entry) + " "
    tags = [entry.get("category", "general").casefold().replace(" ", "-")]
    for tag, needles in TAG_RULES.items():
        if any(has_keyword(haystack, needle) for needle in needles):
            tags.append(tag)
    if subcategory != "General":
        tags.append(subcategory.casefold().replace(" & ", "-").replace(" ", "-"))
    return list(dict.fromkeys(tag for tag in tags if tag))[:8]


def infer_aliases(entry: dict[str, Any]) -> list[str]:
    haystack = _text(entry)
    aliases = [alias for term, alias in ALIAS_RULES.items() if has_keyword(haystack, term)]
    name = str(entry.get("name", ""))
    if " & " in name:
        aliases.append(name.replace(" & ", " and "))
    return list(dict.fromkeys(aliases))[:8]


def normalize_entry(raw: dict[str, Any], *, bootstrap: bool = False) -> dict[str, Any]:
    """Return fields in canonical order while filling conservative defaults."""
    original_category = raw.get("legacyCategory") or raw.get("category")
    category = infer_domain(raw) if bootstrap else raw.get("category")
    base = {
        "slug": raw.get("slug"),
        "name": raw.get("name"),
        "description": raw.get("description"),
        "category": category,
        "legacyCategory": original_category if category != original_category else raw.get("legacyCategory"),
        "subcategory": raw.get("subcategory"),
        "tags": raw.get("tags"),
        "aliases": raw.get("aliases"),
        "icon": raw.get("icon"),
        "added": raw.get("added"),
        "risk": raw.get("risk", "unknown"),
        "maturity": raw.get("maturity", "unreviewed"),
        "reviewedAt": raw.get("reviewedAt"),
        "method": raw.get("method"),
        "sources": raw.get("sources", []),
        "testCases": raw.get("testCases", []),
        "listed": raw.get("listed", True),
    }
    if bootstrap or not base["subcategory"]:
        base["subcategory"] = infer_subcategory(base)
    if bootstrap or base["tags"] is None:
        base["tags"] = infer_tags(base, str(base["subcategory"]))
    if bootstrap or base["aliases"] is None:
        base["aliases"] = infer_aliases(base)
    return base


def import_legacy(path: Path) -> list[dict[str, Any]]:
    """Read the old generated JS format for the one-time catalog migration."""
    text = path.read_text(encoding="utf-8")
    tools: list[dict[str, Any]] = []
    for match in LEGACY_OBJECT_RE.finditer(text):
        entry: dict[str, Any] = {}
        for field in LEGACY_FIELD_RE.finditer(match.group(1)):
            entry[field.group(1)] = json.loads(field.group(2))
        if entry:
            tools.append(normalize_entry(entry, bootstrap=True))
    if not tools:
        raise ValueError(f"{path}: no legacy registry entries found")
    return tools


def load_catalog(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or not isinstance(document.get("tools"), list):
        raise ValueError(f"{path}: expected an object with a tools array")
    if any(not isinstance(tool, dict) for tool in document["tools"]):
        raise ValueError(f"{path}: every tools item must be an object")
    return document, document["tools"]


def valid_datetime(value: str) -> bool:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return "T" in value and (value.endswith("Z") or re.search(r"[+-]\d\d:\d\d$", value) is not None)
    except (TypeError, ValueError):
        return False


def curated_slugs(project_root: Path, frontend: Path) -> set[str]:
    policy_path = project_root / "tool-curation.json"
    if not policy_path.is_file():
        return set()
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    hidden = set(policy.get("unlist", [])) | set(policy.get("redirects", {}))
    generated_path = project_root / "generated-conversion-tools.json"
    if generated_path.is_file():
        generated = json.loads(generated_path.read_text(encoding="utf-8"))
        hidden.update(generated.get("legacy_redirects", {}))
    keep = set(policy.get("keep", []))
    prefixes = tuple(policy.get("unlist_prefixes", []))
    if prefixes:
        for page in (frontend / "tools").glob("*/index.html"):
            if page.parent.name.startswith(prefixes) and page.parent.name not in keep:
                hidden.add(page.parent.name)
    return hidden - keep


def validate_catalog(tools: list[dict[str, Any]], frontend: Path) -> list[str]:
    issues: list[str] = []
    seen: set[str] = set()
    required_strings = ("slug", "name", "description", "category", "subcategory", "icon", "added")
    allowed_keys = {
        "slug", "name", "description", "category", "legacyCategory", "subcategory", "tags", "aliases",
        "icon", "added", "risk", "maturity", "reviewedAt", "guidance", "method", "sources",
        "testCases", "listed",
    }
    for index, tool in enumerate(tools):
        label = tool.get("slug") or f"entry {index}"
        unknown = set(tool) - allowed_keys
        if unknown:
            issues.append(f"{label}: unsupported fields: {', '.join(sorted(unknown))}")
        for key in required_strings:
            if not isinstance(tool.get(key), str) or not tool[key].strip():
                issues.append(f"{label}: {key} must be a non-empty string")
        if isinstance(tool.get("added"), str) and not valid_datetime(tool["added"]):
            issues.append(f"{label}: added must be an RFC 3339 date-time")
        if tool.get("legacyCategory") is not None and not isinstance(tool.get("legacyCategory"), str):
            issues.append(f"{label}: legacyCategory must be a string or null")
        slug = tool.get("slug")
        if isinstance(slug, str):
            if not SLUG_RE.fullmatch(slug):
                issues.append(f"{label}: slug must be lowercase kebab-case")
            if slug in seen:
                issues.append(f"duplicate catalog slug: {slug}")
            seen.add(slug)
            if not (frontend / "tools" / slug / "index.html").is_file():
                issues.append(f"{label}: tool page is missing")
        for key in ("tags", "aliases"):
            values = tool.get(key)
            if not isinstance(values, list) or any(not isinstance(v, str) or not v.strip() for v in values):
                issues.append(f"{label}: {key} must contain non-empty strings")
            elif len(values) != len(set(values)):
                issues.append(f"{label}: {key} contains duplicates")
        if tool.get("risk") not in RISK_VALUES:
            issues.append(f"{label}: invalid risk {tool.get('risk')!r}")
        if tool.get("maturity") not in MATURITY_VALUES:
            issues.append(f"{label}: invalid maturity {tool.get('maturity')!r}")
        for key in ("reviewedAt", "guidance", "method"):
            if tool.get(key) is not None and not isinstance(tool.get(key), str):
                issues.append(f"{label}: {key} must be a string or null")
        if isinstance(tool.get("guidance"), str) and not tool["guidance"].strip():
            issues.append(f"{label}: guidance must not be blank")
        if isinstance(tool.get("reviewedAt"), str) and not valid_datetime(tool["reviewedAt"]):
            issues.append(f"{label}: reviewedAt must be an RFC 3339 date-time")
        if not isinstance(tool.get("sources"), list):
            issues.append(f"{label}: sources must be an array")
        else:
            for source in tool["sources"]:
                if not isinstance(source, dict) or not isinstance(source.get("title"), str):
                    issues.append(f"{label}: each source requires a title")
                elif source.get("url") is not None and not isinstance(source.get("url"), str):
                    issues.append(f"{label}: source URL must be a string")
                elif set(source) - {"title", "url"}:
                    issues.append(f"{label}: source contains unsupported fields")
        if not isinstance(tool.get("testCases"), list) or any(not isinstance(v, dict) for v in tool.get("testCases", [])):
            issues.append(f"{label}: testCases must be an array of objects")
        if not isinstance(tool.get("listed"), bool):
            issues.append(f"{label}: listed must be boolean")
    return issues


def public_tools(tools: list[dict[str, Any]], hidden: set[str]) -> list[dict[str, Any]]:
    return [tool for tool in tools if tool["listed"] and tool["slug"] not in hidden]


def public_guidance(tool: dict[str, Any]) -> str | None:
    explicit = tool.get("guidance")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    tailored = PUBLIC_TOOL_GUIDANCE.get(tool["slug"])
    if tailored:
        return tailored
    if tool.get("risk") == "low":
        return None
    category_guidance = PUBLIC_CATEGORY_GUIDANCE.get(tool.get("category"))
    if category_guidance:
        return category_guidance
    return PUBLIC_GUIDANCE.get(tool.get("risk"))


def render_browser_registry(tools: list[dict[str, Any]]) -> str:
    # Keep the eagerly loaded homepage payload lean.  Detailed methodology,
    # sources, and tests live in per-tool metadata files loaded only on that
    # tool's page.
    lean = []
    for tool in tools:
        entry = {
            key: tool[key]
            for key in ("slug", "name", "description", "category", "subcategory", "icon", "added")
        }
        redundant_tags = {
            tool["category"].casefold().replace(" ", "-"),
            tool["subcategory"].casefold().replace(" & ", "-").replace(" ", "-"),
        }
        useful_tags = [tag for tag in tool.get("tags", []) if tag not in redundant_tags]
        if useful_tags:
            entry["tags"] = useful_tags
        if tool.get("aliases"):
            entry["aliases"] = tool["aliases"]
        # Internal risk classifications stay in the canonical record and are
        # enforced at publication time; public cards do not expose taxonomy.
        if tool.get("maturity") != "unreviewed":
            entry["maturity"] = tool["maturity"]
        if tool.get("reviewedAt"):
            entry["reviewedAt"] = tool["reviewedAt"]
        lean.append(entry)
    payload = json.dumps(lean, ensure_ascii=False, separators=(",", ":"))
    return (
        "/* Generated by scripts/generate_tool_catalog.py from tool-catalog.json.\n"
        " * Do not edit this file directly. */\n"
        f"window.VIRTUAL_TOOLS = {payload};\n"
    )


def metadata_documents(tools: list[dict[str, Any]]) -> dict[str, str]:
    """Build small public, per-route metadata documents for the shared shell."""
    documents: dict[str, str] = {}
    for tool in tools:
        ranked: list[tuple[int, str, dict[str, Any]]] = []
        own_tags = set(tool.get("tags") or [])
        for candidate in tools:
            if candidate["slug"] == tool["slug"]:
                continue
            score = 0
            if candidate["category"] == tool["category"]:
                score += 10
            if candidate["subcategory"] == tool["subcategory"]:
                score += 4
            score += 2 * len(own_tags & set(candidate.get("tags") or []))
            if score:
                ranked.append((-score, candidate["name"].casefold(), candidate))
        ranked.sort(key=lambda row: (row[0], row[1]))
        related = [
            {"slug": candidate["slug"], "name": candidate["name"]}
            for _, _, candidate in ranked[:4]
        ]
        metadata: dict[str, Any] = {
            "slug": tool["slug"],
            "category": tool["category"],
            "subcategory": tool["subcategory"],
            "maturity": tool["maturity"],
            "reviewedAt": tool.get("reviewedAt"),
            "testCaseCount": len(tool.get("testCases") or []),
            "related": related,
        }
        guidance = public_guidance(tool)
        if guidance:
            metadata["guidance"] = guidance
        if tool.get("method"):
            metadata["method"] = tool["method"]
        if tool.get("sources"):
            metadata["sources"] = tool["sources"]
        documents[tool["slug"]] = json.dumps(metadata, ensure_ascii=False, separators=(",", ":")) + "\n"
    return documents


def write_browser_artifacts(frontend: Path, tools: list[dict[str, Any]], *, check: bool = False) -> list[str]:
    issues: list[str] = []
    generated_path = frontend / "assets" / GENERATED_FILENAME
    expected_registry = render_browser_registry(tools)
    meta_dir = frontend / "assets" / METADATA_DIRNAME
    expected_metadata = metadata_documents(tools)
    if check:
        actual = generated_path.read_text(encoding="utf-8") if generated_path.is_file() else ""
        if actual != expected_registry:
            issues.append(f"{generated_path}: stale")
        actual_files = {path.stem for path in meta_dir.glob("*.json")} if meta_dir.is_dir() else set()
        expected_files = set(expected_metadata)
        for slug in sorted(expected_files):
            path = meta_dir / f"{slug}.json"
            if not path.is_file() or path.read_text(encoding="utf-8") != expected_metadata[slug]:
                issues.append(f"{path}: missing or stale")
        for slug in sorted(actual_files - expected_files):
            issues.append(f"{meta_dir / (slug + '.json')}: stale unpublished metadata")
        return issues

    generated_path.write_text(expected_registry, encoding="utf-8")
    meta_dir.mkdir(parents=True, exist_ok=True)
    for slug, payload in expected_metadata.items():
        (meta_dir / f"{slug}.json").write_text(payload, encoding="utf-8")
    # This directory contains generated files only. Remove metadata for tools
    # that became unlisted so shared UI can never expose quarantined entries.
    for path in meta_dir.glob("*.json"):
        if path.stem not in expected_metadata:
            path.unlink()
    return issues


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("frontend", nargs="?", type=Path, default=Path(__file__).resolve().parents[1] / "frontend")
    parser.add_argument("--check", action="store_true", help="fail if tools.js is stale")
    parser.add_argument("--import-legacy", action="store_true", help="bootstrap JSON from the old tools.js format")
    parser.add_argument("--sync-curation", action="store_true", help="persist policy exclusions as listed:false")
    parser.add_argument("--refresh-taxonomy", action="store_true", help="recompute domain, subcategory, tags, and aliases")
    args = parser.parse_args()

    frontend = args.frontend.resolve()
    project_root = frontend.parent
    assets = frontend / "assets"
    catalog_path = assets / CATALOG_FILENAME
    generated_path = assets / GENERATED_FILENAME

    if args.import_legacy:
        if catalog_path.exists():
            print(f"refusing to overwrite existing canonical catalog: {catalog_path}", file=sys.stderr)
            return 2
        tools = import_legacy(generated_path)
        document = {"$schema": "./tool-catalog.schema.json", "version": SCHEMA_VERSION, "tools": tools}
        catalog_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        document, tools = load_catalog(catalog_path)

    if args.refresh_taxonomy:
        tools = [normalize_entry(tool, bootstrap=True) for tool in tools]
        document["tools"] = tools
        catalog_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if document.get("version") != SCHEMA_VERSION:
        print(f"{catalog_path}: unsupported version {document.get('version')!r}", file=sys.stderr)
        return 1
    document_issues = []
    if document.get("$schema") != "./tool-catalog.schema.json":
        document_issues.append(f"{catalog_path}: $schema must reference ./tool-catalog.schema.json")
    unknown_document_fields = set(document) - {"$schema", "version", "tools"}
    if unknown_document_fields:
        document_issues.append(
            f"{catalog_path}: unsupported document fields: {', '.join(sorted(unknown_document_fields))}"
        )
    schema_path = assets / "tool-catalog.schema.json"
    try:
        schema_document = json.loads(schema_path.read_text(encoding="utf-8"))
        if schema_document.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            document_issues.append(f"{schema_path}: expected JSON Schema draft 2020-12")
    except (OSError, json.JSONDecodeError) as exc:
        document_issues.append(f"{schema_path}: {exc}")
    if document_issues:
        print("\n".join(document_issues), file=sys.stderr)
        return 1
    hidden = curated_slugs(project_root, frontend)
    if args.sync_curation:
        changed = False
        for tool in tools:
            if tool["slug"] in hidden and tool["listed"]:
                tool["listed"] = False
                changed = True
        if changed:
            document["tools"] = tools
            catalog_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    issues = validate_catalog(tools, frontend)
    if issues:
        print("\n".join(issues), file=sys.stderr)
        return 1
    public = public_tools(tools, hidden)
    artifact_issues = write_browser_artifacts(frontend, public, check=args.check)
    if artifact_issues:
        print("\n".join(artifact_issues) + "\nrun scripts/generate_tool_catalog.py", file=sys.stderr)
        return 1
    print(f"Validated {len(tools)} catalog entries; generated {len(public)} public tools")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
