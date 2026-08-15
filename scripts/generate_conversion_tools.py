#!/usr/bin/env python3
"""Generate deterministic, bidirectional unit-conversion tool pages."""

from __future__ import annotations

import html
import itertools
import json
import re
from pathlib import Path

from validate_tools import parse_registry


TARGET_NEW_TOOLS = 1047
ADDED = "2026-08-06T00:00:00Z"


def u(slug: str, name: str, symbol: str, scale: float, offset: float = 0) -> dict:
    return {"slug": slug, "name": name, "symbol": symbol, "scale": scale, "offset": offset}


GROUPS = [
    ("length", "Length", [u("nanometers","Nanometers","nm",1e-9),u("micrometers","Micrometers","µm",1e-6),u("millimeters","Millimeters","mm",1e-3),u("centimeters","Centimeters","cm",1e-2),u("meters","Meters","m",1),u("kilometers","Kilometers","km",1e3),u("inches","Inches","in",0.0254),u("feet","Feet","ft",0.3048),u("yards","Yards","yd",0.9144),u("miles","Miles","mi",1609.344),u("nautical-miles","Nautical miles","nmi",1852),u("furlongs","Furlongs","fur",201.168)]),
    ("area", "Area", [u("square-millimeters","Square millimeters","mm²",1e-6),u("square-centimeters","Square centimeters","cm²",1e-4),u("square-meters","Square meters","m²",1),u("hectares","Hectares","ha",1e4),u("square-kilometers","Square kilometers","km²",1e6),u("square-inches","Square inches","in²",0.00064516),u("square-feet","Square feet","ft²",0.09290304),u("square-yards","Square yards","yd²",0.83612736),u("acres","Acres","ac",4046.8564224),u("square-miles","Square miles","mi²",2589988.110336)]),
    ("volume", "Volume", [u("milliliters","Milliliters","mL",1e-6),u("centiliters","Centiliters","cL",1e-5),u("deciliters","Deciliters","dL",1e-4),u("liters","Liters","L",1e-3),u("cubic-meters","Cubic meters","m³",1),u("teaspoons-us","US teaspoons","tsp",4.92892159375e-6),u("tablespoons-us","US tablespoons","tbsp",1.478676478125e-5),u("fluid-ounces-us","US fluid ounces","fl oz",2.95735295625e-5),u("cups-us","US cups","cup",0.0002365882365),u("pints-us","US pints","pt",0.000473176473),u("quarts-us","US quarts","qt",0.000946352946),u("gallons-us","US gallons","gal",0.003785411784),u("gallons-imperial","Imperial gallons","imp gal",0.00454609),u("cubic-feet","Cubic feet","ft³",0.028316846592)]),
    ("mass", "Mass", [u("micrograms","Micrograms","µg",1e-9),u("milligrams","Milligrams","mg",1e-6),u("grams","Grams","g",1e-3),u("kilograms","Kilograms","kg",1),u("metric-tonnes","Metric tonnes","t",1000),u("ounces","Ounces","oz",0.028349523125),u("pounds","Pounds","lb",0.45359237),u("stones","Stones","st",6.35029318),u("short-tons","US short tons","short ton",907.18474),u("long-tons","Imperial long tons","long ton",1016.0469088),u("carats","Carats","ct",0.0002)]),
    ("time", "Time", [u("nanoseconds","Nanoseconds","ns",1e-9),u("microseconds","Microseconds","µs",1e-6),u("milliseconds","Milliseconds","ms",1e-3),u("seconds","Seconds","s",1),u("minutes","Minutes","min",60),u("hours","Hours","h",3600),u("days","Days","d",86400),u("weeks","Weeks","wk",604800),u("fortnights","Fortnights","fortnight",1209600),u("julian-years","Julian years","a",31557600)]),
    ("speed", "Speed", [u("meters-per-second","Meters per second","m/s",1),u("kilometers-per-hour","Kilometers per hour","km/h",0.2777777777777778),u("miles-per-hour","Miles per hour","mph",0.44704),u("feet-per-second","Feet per second","ft/s",0.3048),u("knots","Knots","kn",0.5144444444444445),u("mach","Mach (standard atmosphere)","Mach",340.29),u("centimeters-per-second","Centimeters per second","cm/s",0.01),u("kilometers-per-second","Kilometers per second","km/s",1000)]),
    ("pressure", "Pressure", [u("pascals","Pascals","Pa",1),u("kilopascals","Kilopascals","kPa",1000),u("megapascals","Megapascals","MPa",1e6),u("bars","Bars","bar",1e5),u("millibars","Millibars","mbar",100),u("atmospheres","Standard atmospheres","atm",101325),u("torr","Torr","Torr",101325/760),u("millimeters-mercury","Millimeters of mercury","mmHg",133.322387415),u("psi","Pounds per square inch","psi",6894.757293168),u("ksi","Kips per square inch","ksi",6894757.293168),u("inches-water","Inches of water","inH₂O",249.08891)]),
    ("energy", "Energy", [u("joules","Joules","J",1),u("kilojoules","Kilojoules","kJ",1000),u("megajoules","Megajoules","MJ",1e6),u("watt-hours","Watt-hours","Wh",3600),u("kilowatt-hours","Kilowatt-hours","kWh",3.6e6),u("calories","Thermochemical calories","cal",4.184),u("kilocalories","Kilocalories","kcal",4184),u("btu","British thermal units","BTU",1055.05585262),u("foot-pounds","Foot-pounds","ft·lbf",1.3558179483314),u("electronvolts","Electronvolts","eV",1.602176634e-19),u("therms-us","US therms","therm",105480400)]),
    ("power", "Power", [u("milliwatts","Milliwatts","mW",0.001),u("watts","Watts","W",1),u("kilowatts","Kilowatts","kW",1000),u("megawatts","Megawatts","MW",1e6),u("gigawatts","Gigawatts","GW",1e9),u("horsepower-mechanical","Mechanical horsepower","hp",745.6998715822702),u("horsepower-metric","Metric horsepower","PS",735.49875),u("btu-per-hour","BTU per hour","BTU/h",0.2930710701722222),u("foot-pounds-per-second","Foot-pounds per second","ft·lbf/s",1.3558179483314)]),
    ("angle", "Plane angle", [u("degrees","Degrees","°",0.017453292519943295),u("radians","Radians","rad",1),u("gradians","Gradians","gon",0.015707963267948967),u("turns","Turns","turn",6.283185307179586),u("arcminutes","Arcminutes","arcmin",0.0002908882086657216),u("arcseconds","Arcseconds","arcsec",4.84813681109536e-6),u("milliradians","Milliradians","mrad",0.001),u("mils-nato","NATO mils","mil",0.0009817477042468104)]),
    ("digital-storage", "Digital storage", [u("bits","Bits","bit",0.125),u("bytes","Bytes","B",1),u("kilobytes","Kilobytes","kB",1e3),u("megabytes","Megabytes","MB",1e6),u("gigabytes","Gigabytes","GB",1e9),u("terabytes","Terabytes","TB",1e12),u("kibibytes","Kibibytes","KiB",1024),u("mebibytes","Mebibytes","MiB",1048576),u("gibibytes","Gibibytes","GiB",1073741824),u("tebibytes","Tebibytes","TiB",1099511627776)]),
    ("frequency", "Frequency", [u("millihertz","Millihertz","mHz",0.001),u("hertz","Hertz","Hz",1),u("kilohertz","Kilohertz","kHz",1e3),u("megahertz","Megahertz","MHz",1e6),u("gigahertz","Gigahertz","GHz",1e9),u("terahertz","Terahertz","THz",1e12),u("revolutions-per-minute","Revolutions per minute","rpm",1/60),u("beats-per-minute","Beats per minute","bpm",1/60)]),
    ("force", "Force", [u("newtons","Newtons","N",1),u("kilonewtons","Kilonewtons","kN",1000),u("meganewtons","Meganewtons","MN",1e6),u("dynes","Dynes","dyn",1e-5),u("pound-force","Pound-force","lbf",4.4482216152605),u("ounce-force","Ounce-force","ozf",0.2780138509537812),u("kilogram-force","Kilogram-force","kgf",9.80665),u("ton-force-us","US ton-force","tonf",8896.443230521)]),
    ("torque", "Torque", [u("newton-meters","Newton-meters","N·m",1),u("newton-centimeters","Newton-centimeters","N·cm",0.01),u("kilonewton-meters","Kilonewton-meters","kN·m",1000),u("dyne-centimeters","Dyne-centimeters","dyn·cm",1e-7),u("pound-feet","Pound-feet","lbf·ft",1.3558179483314),u("pound-inches","Pound-inches","lbf·in",0.1129848290276167),u("ounce-inches","Ounce-inches","ozf·in",0.00706155181422604),u("kilogram-force-meters","Kilogram-force meters","kgf·m",9.80665)]),
    ("density", "Density", [u("kilograms-per-cubic-meter","Kilograms per cubic meter","kg/m³",1),u("grams-per-cubic-centimeter","Grams per cubic centimeter","g/cm³",1000),u("grams-per-liter","Grams per liter","g/L",1),u("kilograms-per-liter","Kilograms per liter","kg/L",1000),u("pounds-per-cubic-foot","Pounds per cubic foot","lb/ft³",16.01846337396014),u("pounds-per-cubic-inch","Pounds per cubic inch","lb/in³",27679.90471020312),u("ounces-per-cubic-inch","Ounces per cubic inch","oz/in³",1729.994044387695)]),
    ("flow-rate", "Volumetric flow rate", [u("cubic-meters-per-second","Cubic meters per second","m³/s",1),u("liters-per-second","Liters per second","L/s",0.001),u("liters-per-minute","Liters per minute","L/min",1/60000),u("liters-per-hour","Liters per hour","L/h",1/3600000),u("cubic-meters-per-hour","Cubic meters per hour","m³/h",1/3600),u("gallons-us-per-minute","US gallons per minute","gpm",0.003785411784/60),u("gallons-us-per-hour","US gallons per hour","gph",0.003785411784/3600),u("cubic-feet-per-minute","Cubic feet per minute","cfm",0.028316846592/60),u("cubic-feet-per-second","Cubic feet per second","cfs",0.028316846592)]),
    ("acceleration", "Acceleration", [u("meters-per-second-squared","Meters per second squared","m/s²",1),u("centimeters-per-second-squared","Centimeters per second squared","cm/s²",0.01),u("feet-per-second-squared","Feet per second squared","ft/s²",0.3048),u("inches-per-second-squared","Inches per second squared","in/s²",0.0254),u("standard-gravity","Standard gravity","g₀",9.80665),u("galileos","Galileos","Gal",0.01),u("milli-g","Milli-g","mg₀",0.00980665)]),
    ("temperature", "Temperature", [u("celsius","Degrees Celsius","°C",1,273.15),u("fahrenheit","Degrees Fahrenheit","°F",5/9,255.3722222222222),u("kelvin","Kelvin","K",1,0),u("rankine","Degrees Rankine","°R",5/9,0),u("reaumur","Degrees Réaumur","°Ré",1.25,273.15)]),
    ("electric-charge", "Electric charge", [u("coulombs","Coulombs","C",1),u("millicoulombs","Millicoulombs","mC",1e-3),u("microcoulombs","Microcoulombs","µC",1e-6),u("nanocoulombs","Nanocoulombs","nC",1e-9),u("ampere-hours","Ampere-hours","Ah",3600),u("milliampere-hours","Milliampere-hours","mAh",3.6),u("elementary-charges","Elementary charges","e",1.602176634e-19)]),
    ("electric-current", "Electric current", [u("nanoamperes","Nanoamperes","nA",1e-9),u("microamperes","Microamperes","µA",1e-6),u("milliamperes","Milliamperes","mA",1e-3),u("amperes","Amperes","A",1),u("kiloamperes","Kiloamperes","kA",1e3),u("megaamperes","Megaamperes","MA",1e6),u("abamperes","Abamperes","abA",10)]),
    ("voltage", "Electric potential", [u("nanovolts","Nanovolts","nV",1e-9),u("microvolts","Microvolts","µV",1e-6),u("millivolts","Millivolts","mV",1e-3),u("volts","Volts","V",1),u("kilovolts","Kilovolts","kV",1e3),u("megavolts","Megavolts","MV",1e6),u("gigavolts","Gigavolts","GV",1e9)]),
    ("resistance", "Electrical resistance", [u("microohms","Microohms","µΩ",1e-6),u("milliohms","Milliohms","mΩ",1e-3),u("ohms","Ohms","Ω",1),u("kiloohms","Kiloohms","kΩ",1e3),u("megaohms","Megaohms","MΩ",1e6),u("gigaohms","Gigaohms","GΩ",1e9),u("statohms","Statohms","statΩ",8.987551787e11)]),
    ("capacitance", "Capacitance", [u("femtofarads","Femtofarads","fF",1e-15),u("picofarads","Picofarads","pF",1e-12),u("nanofarads","Nanofarads","nF",1e-9),u("microfarads","Microfarads","µF",1e-6),u("millifarads","Millifarads","mF",1e-3),u("farads","Farads","F",1),u("kilofarads","Kilofarads","kF",1e3)]),
    ("inductance", "Inductance", [u("nanohenries","Nanohenries","nH",1e-9),u("microhenries","Microhenries","µH",1e-6),u("millihenries","Millihenries","mH",1e-3),u("henries","Henries","H",1),u("kilohenries","Kilohenries","kH",1e3),u("megahenries","Megahenries","MH",1e6)]),
    ("conductance", "Electrical conductance", [u("microsiemens","Microsiemens","µS",1e-6),u("millisiemens","Millisiemens","mS",1e-3),u("siemens","Siemens","S",1),u("kilosiemens","Kilosiemens","kS",1e3),u("megasiemens","Megasiemens","MS",1e6),u("mhos","Mhos","℧",1)]),
    ("magnetic-flux", "Magnetic flux", [u("webers","Webers","Wb",1),u("milliwebers","Milliwebers","mWb",1e-3),u("microwebers","Microwebers","µWb",1e-6),u("nanowebers","Nanowebers","nWb",1e-9),u("maxwells","Maxwells","Mx",1e-8),u("volt-seconds","Volt-seconds","V·s",1)]),
    ("magnetic-field", "Magnetic flux density", [u("teslas","Teslas","T",1),u("milliteslas","Milliteslas","mT",1e-3),u("microteslas","Microteslas","µT",1e-6),u("nanoteslas","Nanoteslas","nT",1e-9),u("gauss","Gauss","G",1e-4),u("milligauss","Milligauss","mG",1e-7)]),
    ("dynamic-viscosity", "Dynamic viscosity", [u("pascal-seconds","Pascal-seconds","Pa·s",1),u("millipascal-seconds","Millipascal-seconds","mPa·s",1e-3),u("poise","Poise","P",0.1),u("centipoise","Centipoise","cP",1e-3),u("pound-force-seconds-per-square-foot","Pound-force seconds per square foot","lbf·s/ft²",47.88025898033584),u("pounds-per-foot-second","Pounds per foot-second","lb/(ft·s)",1.4881639435695538)]),
    ("kinematic-viscosity", "Kinematic viscosity", [u("square-meters-per-second","Square meters per second","m²/s",1),u("square-centimeters-per-second","Square centimeters per second","cm²/s",1e-4),u("square-millimeters-per-second","Square millimeters per second","mm²/s",1e-6),u("stokes","Stokes","St",1e-4),u("centistokes","Centistokes","cSt",1e-6),u("square-feet-per-second","Square feet per second","ft²/s",0.09290304)]),
    ("illuminance", "Illuminance", [u("lux","Lux","lx",1),u("kilolux","Kilolux","klx",1000),u("millilux","Millilux","mlx",0.001),u("foot-candles","Foot-candles","fc",10.76391041670972),u("phot","Phot","ph",10000),u("nox","Nox","nx",0.001)]),
    ("radioactivity", "Radioactivity", [u("becquerels","Becquerels","Bq",1),u("kilobecquerels","Kilobecquerels","kBq",1e3),u("megabecquerels","Megabecquerels","MBq",1e6),u("gigabecquerels","Gigabecquerels","GBq",1e9),u("curies","Curies","Ci",3.7e10),u("millicuries","Millicuries","mCi",3.7e7),u("microcuries","Microcuries","µCi",3.7e4),u("rutherfords","Rutherfords","Rd",1e6)]),
    ("absorbed-dose", "Absorbed radiation dose", [u("grays","Grays","Gy",1),u("milligrays","Milligrays","mGy",1e-3),u("micrograys","Micrograys","µGy",1e-6),u("rads","Rads","rad",0.01),u("millirads","Millirads","mrad",1e-5),u("ergs-per-gram","Ergs per gram","erg/g",1e-4)]),
    ("equivalent-dose", "Equivalent radiation dose", [u("sieverts","Sieverts","Sv",1),u("millisieverts","Millisieverts","mSv",1e-3),u("microsieverts","Microsieverts","µSv",1e-6),u("rems","Roentgen equivalent man","rem",0.01),u("millirems","Millirems","mrem",1e-5)]),
    ("amount", "Amount of substance", [u("nanomoles","Nanomoles","nmol",1e-9),u("micromoles","Micromoles","µmol",1e-6),u("millimoles","Millimoles","mmol",1e-3),u("moles","Moles","mol",1),u("kilomoles","Kilomoles","kmol",1e3),u("pound-moles","Pound-moles","lbmol",453.59237)]),
    ("momentum", "Momentum", [u("kilogram-meters-per-second","Kilogram-meters per second","kg·m/s",1),u("gram-centimeters-per-second","Gram-centimeters per second","g·cm/s",1e-5),u("newton-seconds","Newton-seconds","N·s",1),u("pound-feet-per-second","Pound-feet per second","lb·ft/s",0.138254954376),u("pound-force-seconds","Pound-force seconds","lbf·s",4.4482216152605),u("ounce-feet-per-second","Ounce-feet per second","oz·ft/s",0.0086409346485)]),
    ("mass-flow", "Mass flow rate", [u("kilograms-per-second","Kilograms per second","kg/s",1),u("grams-per-second","Grams per second","g/s",0.001),u("kilograms-per-minute","Kilograms per minute","kg/min",1/60),u("kilograms-per-hour","Kilograms per hour","kg/h",1/3600),u("pounds-per-second","Pounds per second","lb/s",0.45359237),u("pounds-per-minute","Pounds per minute","lb/min",0.45359237/60),u("pounds-per-hour","Pounds per hour","lb/h",0.45359237/3600),u("tonnes-per-hour","Metric tonnes per hour","t/h",1000/3600)]),
    ("surface-tension", "Surface tension", [u("newtons-per-meter","Newtons per meter","N/m",1),u("millinewtons-per-meter","Millinewtons per meter","mN/m",1e-3),u("dynes-per-centimeter","Dynes per centimeter","dyn/cm",1e-3),u("pound-force-per-foot","Pound-force per foot","lbf/ft",14.59390293720636),u("pound-force-per-inch","Pound-force per inch","lbf/in",175.1268352464764)]),
]


PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} — virt.tools</title>
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<header id="site-header"></header>
<main class="tool-container">
<h1>{title}</h1>
<p class="subtitle">Convert {from_name} and {to_name} in either direction. Calculations run locally in your browser.</p>
<div class="input-section">
<label for="conversion-value">Value in <span id="conversion-from-label"></span></label>
<input id="conversion-value" type="number" value="1" step="any" inputmode="decimal">
<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem">
<button id="conversion-swap" type="button" class="primary-btn">Swap direction</button>
<button id="conversion-copy" type="button">Copy result</button>
</div>
</div>
<section class="result-section" aria-live="polite">
<div class="result-row"><span id="conversion-to-label"></span><strong id="conversion-result"></strong></div>
<p id="conversion-equation"></p>
</section>
<script id="conversion-config" type="application/json">{config}</script>
</main>
<script src="/assets/app.js"></script>
<script src="/assets/conversion-tool.js"></script>
</body>
</html>
"""


def js_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def registry_block(tool: dict) -> str:
    return (
        "  {\n"
        f'    slug: "{js_string(tool["slug"])}",\n'
        f'    name: "{js_string(tool["name"])}",\n'
        f'    description: "{js_string(tool["description"])}",\n'
        '    category: "Converters",\n'
        '    icon: "⇄",\n'
        f'    added: "{ADDED}",\n'
        "  },\n"
    )


def candidates() -> list[dict]:
    by_group: list[list[dict]] = []
    for group_slug, quantity, units in GROUPS:
        group_tools = []
        for left, right in itertools.combinations(units, 2):
            slug = f"{left['slug']}-to-{right['slug']}"
            title = f"{left['name']} to {right['name']} Converter"
            group_tools.append({
                "slug": slug,
                "name": title,
                "description": f"Convert between {left['name']} ({left['symbol']}) and {right['name']} ({right['symbol']}) in either direction.",
                "quantity": quantity,
                "group": group_slug,
                "from": left,
                "to": right,
            })
        by_group.append(group_tools)

    selected = []
    for rows in itertools.zip_longest(*by_group):
        for row in rows:
            if row is not None:
                selected.append(row)
                if len(selected) == TARGET_NEW_TOOLS:
                    return selected
    raise RuntimeError(f"Only {len(selected)} conversion pairs are defined")


def main() -> int:
    raise RuntimeError(
        "Pair-specific generation was retired; run scripts/consolidate_conversion_tools.py instead"
    )
    # Retained below only as migration history and the audited unit-definition source.
    root = Path(__file__).resolve().parents[1]
    frontend = root / "frontend"
    registry = frontend / "assets" / "tools.js"
    manifest_path = root / "generated-conversion-tools.json"
    tools = candidates()
    existing_pages = {p.parent.name for p in (frontend / "tools").glob("*/index.html")}
    previous = set()
    if manifest_path.is_file():
        old_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        previous = set(old_manifest.get("slugs", [])) | {
            tool["slug"] for tool in old_manifest.get("tools", [])
        }
    collisions = sorted(({tool["slug"] for tool in tools} & existing_pages) - previous)
    if collisions:
        raise RuntimeError("Generated slug collisions: " + ", ".join(collisions))

    for tool in tools:
        page_dir = frontend / "tools" / tool["slug"]
        page_dir.mkdir(parents=True, exist_ok=True)
        config = json.dumps({"from": tool["from"], "to": tool["to"]}, ensure_ascii=False, separators=(",", ":"))
        page = PAGE.format(
            title=html.escape(tool["name"]),
            from_name=html.escape(tool["from"]["name"]),
            to_name=html.escape(tool["to"]["name"]),
            config=config.replace("</", "<\\/"),
        )
        (page_dir / "index.html").write_text(page, encoding="utf-8")

    prefix, objects, suffix = parse_registry(registry)
    generated = previous | {tool["slug"] for tool in tools}
    retained = [block for slug, block in objects if slug not in generated]
    registry.write_text(prefix + "".join(retained) + "".join(registry_block(tool) for tool in tools) + suffix, encoding="utf-8")
    manifest_path.write_text(json.dumps({
        "count": len(tools),
        "tools": [
            {
                "slug": tool["slug"],
                "quantity": tool["quantity"],
                "from": tool["from"],
                "to": tool["to"],
            }
            for tool in tools
        ],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(tools)} conversion tools")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
