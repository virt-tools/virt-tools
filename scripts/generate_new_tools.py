#!/usr/bin/env python3
"""Generate new client-side calculator tools from a curated spec table to grow
the catalog toward a target total. Each spec renders a house-style tool page
(see e.g. tools/swr-calculator) and a tools.js registry entry. Specs whose slug
or display name collides with an existing tool (or within the batch) are skipped,
so the emitted set never overlaps existing tools.

Run: python3 scripts/generate_new_tools.py
"""
from __future__ import annotations
import json, os, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
TOOLS_JS = FRONTEND / "assets" / "tools.js"
TOOLS_DIR = FRONTEND / "tools"
TARGET_TOTAL = 2000

# ---- spec table: list of dicts -------------------------------------------
# fields: [[id, label, unit, placeholder], ...]
# rows:   [[label, js_expr, unit], ...]  -- rows[0] is the headline result.
#   js_expr may reference field ids (a,b,c,...) and earlier r0,r1,...
TABLE: list[dict] = []
def T(**kw):
    TABLE.append(kw); return kw

# (entries appended by the table-writer edits below)

# === Geometry (Math) ===
T(slug="regular-polygon-properties",name="Regular Polygon Properties",cat="Math",icon="📐",desc="Area, perimeter, and apothem of a regular polygon from its side count and side length.",fields=[["n","Number of sides","","e.g. 6"],["s","Side length","m","e.g. 2"]],rows=[["Area","0.25*n*s*s/Math.tan(Math.PI/n)","m²"],["Perimeter","n*s","m"],["Apothem","s/(2*Math.tan(Math.PI/n))","m"]],note="A = n·s² / (4·tan(π/n)).")
T(slug="triangle-area-heron",name="Triangle Area (Heron)",cat="Math",icon="📐",desc="Triangle area from three side lengths using Heron's formula, plus the perimeter.",fields=[["a","Side a","m","e.g. 3"],["b","Side b","m","e.g. 4"],["c","Side c","m","e.g. 5"]],rows=[["Area","Math.sqrt(((a+b+c)/2)*((a+b+c)/2-a)*((a+b+c)/2-b)*((a+b+c)/2-c))","m²"],["Perimeter","a+b+c","m"]],note="Heron's formula: A = √(s(s-a)(s-b)(s-c)), s = (a+b+c)/2.")
T(slug="trapezoid-area",name="Trapezoid Area",cat="Math",icon="📐",desc="Area of a trapezoid from the two parallel sides and the height between them.",fields=[["a","Parallel side a","m","e.g. 4"],["b","Parallel side b","m","e.g. 6"],["h","Height","m","e.g. 3"]],rows=[["Area","(a+b)/2*h","m²"]],note="A = (a+b)/2 · h.")
T(slug="ellipse-area",name="Ellipse Area",cat="Math",icon="📐",desc="Area of an ellipse from its semi-major and semi-minor axes.",fields=[["a","Semi-axis a","m","e.g. 5"],["b","Semi-axis b","m","e.g. 3"]],rows=[["Area","Math.PI*a*b","m²"]],note="A = π·a·b.")
T(slug="ellipse-perimeter-ramanujan",name="Ellipse Perimeter (Ramanujan)",cat="Math",icon="📐",desc="Approximate circumference of an ellipse using Ramanujan's first approximation.",fields=[["a","Semi-axis a","m","e.g. 5"],["b","Semi-axis b","m","e.g. 3"]],rows=[["Perimeter","Math.PI*(3*(a+b)-Math.sqrt((3*a+b)*(a+3*b)))","m"]],note="P ≈ π[3(a+b) − √((3a+b)(a+3b))].")
T(slug="annulus-area",name="Annulus Area",cat="Math",icon="📐",desc="Area of the ring between two concentric circles given outer and inner radii.",fields=[["R","Outer radius","m","e.g. 5"],["r","Inner radius","m","e.g. 3"]],rows=[["Area","Math.PI*(R*R-r*r)","m²"]],note="A = π(R² − r²).")
T(slug="circle-sector-properties",name="Circle Sector Properties",cat="Math",icon="📐",desc="Area and arc length of a circular sector from radius and central angle in degrees.",fields=[["r","Radius","m","e.g. 4"],["theta","Central angle","deg","e.g. 90"]],rows=[["Area","Math.PI*r*r*theta/360","m²"],["Arc length","2*Math.PI*r*theta/360","m"]],note="A = θ/360 · πr²; arc = r·θ (θ in rad).")
T(slug="circular-segment-properties",name="Circular Segment Properties",cat="Math",icon="📐",desc="Area and chord length of a circular segment from radius and central angle in degrees.",fields=[["r","Radius","m","e.g. 4"],["theta","Central angle","deg","e.g. 60"]],rows=[["Area","r*r/2*(theta*Math.PI/180-Math.sin(theta*Math.PI/180))","m²"],["Chord","2*r*Math.sin(theta/2*Math.PI/180)","m"]],note="A = r²/2 (θ − sin θ), with θ in radians.")
T(slug="circular-ring-sector-area",name="Circular Ring Sector Area",cat="Math",icon="📐",desc="Area of a ring sector (annular sector) from outer and inner radii and the angle in degrees.",fields=[["R","Outer radius","m","e.g. 5"],["r","Inner radius","m","e.g. 3"],["theta","Angle","deg","e.g. 90"]],rows=[["Area","theta/360*Math.PI*(R*R-r*r)","m²"]],note="A = θ/360 · π(R² − r²).")
T(slug="rhombus-properties",name="Rhombus Properties",cat="Math",icon="📐",desc="Area, side length, and perimeter of a rhombus from its two diagonals.",fields=[["d1","Diagonal 1","m","e.g. 8"],["d2","Diagonal 2","m","e.g. 6"]],rows=[["Area","d1*d2/2","m²"],["Side","Math.sqrt((d1/2)*(d1/2)+(d2/2)*(d2/2))","m"],["Perimeter","4*Math.sqrt((d1/2)*(d1/2)+(d2/2)*(d2/2))","m"]],note="A = d1·d2/2; side = √((d1/2)²+(d2/2)²).")
T(slug="parallelogram-area",name="Parallelogram Area",cat="Math",icon="📐",desc="Area of a parallelogram from its base and the perpendicular height.",fields=[["b","Base","m","e.g. 6"],["h","Height","m","e.g. 4"]],rows=[["Area","b*h","m²"]],note="A = base · height.")
T(slug="kite-area",name="Kite Area",cat="Math",icon="📐",desc="Area of a kite from the lengths of its two diagonals.",fields=[["d1","Diagonal 1","m","e.g. 8"],["d2","Diagonal 2","m","e.g. 6"]],rows=[["Area","d1*d2/2","m²"]],note="A = d1·d2/2.")
T(slug="conical-surface-area",name="Conical Surface Area",cat="Math",icon="📐",desc="Lateral surface area of a right cone from its base radius and slant height.",fields=[["r","Base radius","m","e.g. 3"],["l","Slant height","m","e.g. 5"]],rows=[["Lateral area","Math.PI*r*l","m²"]],note="A = π·r·l.")
T(slug="cone-frustum-volume",name="Cone Frustum Volume",cat="Math",icon="📐",desc="Volume and lateral area of a conical frustum from the two radii and height.",fields=[["R","Bottom radius","m","e.g. 4"],["r","Top radius","m","e.g. 2"],["h","Height","m","e.g. 5"]],rows=[["Volume","Math.PI*h/3*(R*R+R*r+r*r)","m³"],["Lateral area","Math.PI*(R+r)*Math.sqrt((R-r)*(R-r)+h*h)","m²"]],note="V = πh/3 (R²+Rr+r²).")
T(slug="torus-properties",name="Torus Properties",cat="Math",icon="📐",desc="Volume and surface area of a torus from its major and minor radii.",fields=[["R","Major radius","m","e.g. 5"],["r","Minor radius","m","e.g. 1"]],rows=[["Volume","2*Math.PI*Math.PI*R*r*r","m³"],["Surface area","4*Math.PI*Math.PI*R*r","m²"]],note="V = 2π²Rr²; S = 4π²Rr.")
T(slug="ellipsoid-volume",name="Ellipsoid Volume",cat="Math",icon="📐",desc="Volume of an ellipsoid from its three semi-axes.",fields=[["a","Semi-axis a","m","e.g. 3"],["b","Semi-axis b","m","e.g. 2"],["c","Semi-axis c","m","e.g. 1"]],rows=[["Volume","4/3*Math.PI*a*b*c","m³"]],note="V = 4/3 · π·a·b·c.")
T(slug="hemisphere-properties",name="Hemisphere Properties",cat="Math",icon="📐",desc="Curved surface area and volume of a hemisphere from its radius.",fields=[["r","Radius","m","e.g. 4"]],rows=[["Curved area","3*Math.PI*r*r","m²"],["Volume","2/3*Math.PI*r*r*r","m³"]],note="Curved area = 3πr²; volume = 2/3 πr³.")
T(slug="spherical-cap-properties",name="Spherical Cap Properties",cat="Math",icon="📐",desc="Volume and cap surface area of a spherical cap from sphere radius and cap height.",fields=[["R","Sphere radius","m","e.g. 5"],["h","Cap height","m","e.g. 2"]],rows=[["Volume","Math.PI*h*h*(3*R-h)/3","m³"],["Cap area","2*Math.PI*R*h","m²"]],note="V = πh²(3R−h)/3; A = 2πRh.")
T(slug="cube-space-diagonal",name="Cube Space Diagonal",cat="Math",icon="📐",desc="Space diagonal and face diagonal of a cube from its edge length.",fields=[["a","Edge","m","e.g. 3"]],rows=[["Space diagonal","a*Math.sqrt(3)","m"],["Face diagonal","a*Math.sqrt(2)","m"]],note="d = a√3.")
T(slug="rectangular-prism-diagonal",name="Rectangular Prism Diagonal",cat="Math",icon="📐",desc="Space diagonal and volume of a rectangular prism from length, width, and height.",fields=[["l","Length","m","e.g. 4"],["w","Width","m","e.g. 3"],["h","Height","m","e.g. 2"]],rows=[["Diagonal","Math.sqrt(l*l+w*w+h*h)","m"],["Volume","l*w*h","m³"]],note="d = √(l²+w²+h²).")
T(slug="tetrahedron-properties",name="Tetrahedron Properties",cat="Math",icon="📐",desc="Volume and total surface area of a regular tetrahedron from its edge length.",fields=[["a","Edge","m","e.g. 2"]],rows=[["Volume","a*a*a/(6*Math.sqrt(2))","m³"],["Surface area","Math.sqrt(3)*a*a","m²"]],note="V = a³/(6√2); A = √3·a².")
T(slug="octahedron-properties",name="Octahedron Properties",cat="Math",icon="📐",desc="Volume and surface area of a regular octahedron from its edge length.",fields=[["a","Edge","m","e.g. 2"]],rows=[["Volume","Math.sqrt(2)/3*a*a*a","m³"],["Surface area","2*Math.sqrt(3)*a*a","m²"]],note="V = √2/3 · a³; A = 2√3·a².")
T(slug="icosahedron-properties",name="Icosahedron Properties",cat="Math",icon="📐",desc="Volume and surface area of a regular icosahedron from its edge length.",fields=[["a","Edge","m","e.g. 2"]],rows=[["Volume","5/12*(3+Math.sqrt(5))*a*a*a","m³"],["Surface area","5*Math.sqrt(3)*a*a","m²"]],note="V = 5/12(3+√5)a³; A = 5√3·a².")
T(slug="dodecahedron-properties",name="Dodecahedron Properties",cat="Math",icon="📐",desc="Volume and surface area of a regular dodecahedron from its edge length.",fields=[["a","Edge","m","e.g. 2"]],rows=[["Volume","(15+7*Math.sqrt(5))/4*a*a*a","m³"],["Surface area","3*Math.sqrt(25+10*Math.sqrt(5))*a*a","m²"]],note="V = (15+7√5)/4 · a³.")
T(slug="pentagonal-prism-volume",name="Pentagonal Prism Volume",cat="Math",icon="📐",desc="Volume of a regular pentagonal prism from its base edge and height.",fields=[["a","Base edge","m","e.g. 2"],["h","Height","m","e.g. 5"]],rows=[["Volume","1/4*Math.sqrt(5*(5+2*Math.sqrt(5)))*a*a*h","m³"]],note="V = (1/4)√(5(5+2√5)) · a²h.")
T(slug="hexagonal-prism-volume",name="Hexagonal Prism Volume",cat="Math",icon="📐",desc="Volume of a regular hexagonal prism from its base edge and height.",fields=[["a","Base edge","m","e.g. 2"],["h","Height","m","e.g. 5"]],rows=[["Volume","3*Math.sqrt(3)/2*a*a*h","m³"]],note="V = (3√3/2) · a²h.")
T(slug="reuleaux-triangle-properties",name="Reuleaux Triangle Properties",cat="Math",icon="📐",desc="Area and perimeter of a Reuleaux triangle from its width (side of generating triangle).",fields=[["s","Width","m","e.g. 2"]],rows=[["Area","(Math.PI-Math.sqrt(3))/2*s*s","m²"],["Perimeter","Math.PI*s","m"]],note="A = (π−√3)/2 · s²; perimeter = πs.")
T(slug="triangle-area-base-height",name="Triangle Area (Base & Height)",cat="Math",icon="📐",desc="Area of a triangle from its base and perpendicular height.",fields=[["b","Base","m","e.g. 6"],["h","Height","m","e.g. 4"]],rows=[["Area","b*h/2","m²"]],note="A = ½ · b · h.")
T(slug="prism-volume",name="Prism Volume",cat="Math",icon="📐",desc="Volume of a general prism from its base area and height.",fields=[["B","Base area","m²","e.g. 12"],["h","Height","m","e.g. 5"]],rows=[["Volume","B*h","m³"]],note="V = base area · height.")

# === Physics (Math) ===
T(slug="pendulum-period",name="Pendulum Period",cat="Math",icon="📐",desc="Period of a simple pendulum from its length and local gravity.",fields=[["L","Length","m","e.g. 1"],["g","Gravity","m/s²","e.g. 9.81"]],rows=[["Period","2*Math.PI*Math.sqrt(L/g)","s"],["Frequency","1/(2*Math.PI*Math.sqrt(L/g))","Hz"]],note="T = 2π√(L/g).")
T(slug="pendulum-length-from-period",name="Pendulum Length from Period",cat="Math",icon="📐",desc="Pendulum length required for a target period at a given gravity.",fields=[["T","Period","s","e.g. 2"],["g","Gravity","m/s²","e.g. 9.81"]],rows=[["Length","g*Math.pow(T/(2*Math.PI),2)","m"]],note="L = g(T/2π)².")
T(slug="spring-potential-energy",name="Spring Potential Energy",cat="Math",icon="📐",desc="Elastic potential energy stored in a spring from its stiffness and displacement.",fields=[["k","Stiffness","N/m","e.g. 200"],["x","Displacement","m","e.g. 0.1"]],rows=[["Energy","0.5*k*x*x","J"],["Force","k*x","N"]],note="U = ½kx²; F = kx.")
T(slug="kinetic-energy-momentum",name="Kinetic Energy & Momentum",cat="Math",icon="📐",desc="Kinetic energy and momentum of a moving mass from its mass and velocity.",fields=[["m","Mass","kg","e.g. 2"],["v","Velocity","m/s","e.g. 10"]],rows=[["Kinetic energy","0.5*m*v*v","J"],["Momentum","m*v","kg·m/s"]],note="KE = ½mv²; p = mv.")
T(slug="gravitational-potential-energy",name="Gravitational Potential Energy",cat="Math",icon="📐",desc="Gravitational potential energy from mass, height, and gravity.",fields=[["m","Mass","kg","e.g. 5"],["h","Height","m","e.g. 10"],["g","Gravity","m/s²","e.g. 9.81"]],rows=[["Energy","m*g*h","J"]],note="PE = mgh.")
T(slug="impulse-calculator",name="Impulse Calculator",cat="Math",icon="📐",desc="Impulse delivered by a constant force over a time interval.",fields=[["F","Force","N","e.g. 50"],["t","Time","s","e.g. 0.2"]],rows=[["Impulse","F*t","N·s"]],note="J = F·t.")
T(slug="centripetal-acceleration-force",name="Centripetal Acceleration & Force",cat="Math",icon="📐",desc="Centripetal acceleration and the force required to keep a mass on a circular path.",fields=[["m","Mass","kg","e.g. 2"],["v","Velocity","m/s","e.g. 10"],["r","Radius","m","e.g. 5"]],rows=[["Acceleration","v*v/r","m/s²"],["Force","m*v*v/r","N"]],note="a = v²/r; F = mv²/r.")
T(slug="projectile-motion-properties",name="Projectile Motion Properties",cat="Math",icon="📐",desc="Range, maximum height, and time of flight of a projectile from speed and launch angle.",fields=[["v","Speed","m/s","e.g. 20"],["ang","Angle","deg","e.g. 45"]],rows=[["Range","v*v*Math.sin(2*ang*Math.PI/180)/9.81","m"],["Max height","Math.pow(v*Math.sin(ang*Math.PI/180),2)/(2*9.81)","m"],["Time of flight","2*v*Math.sin(ang*Math.PI/180)/9.81","s"]],note="Vacuum projectile (no drag), g = 9.81 m/s².")
T(slug="free-fall-properties",name="Free Fall Properties",cat="Math",icon="📐",desc="Distance fallen and final velocity for an object in free fall over a time.",fields=[["t","Time","s","e.g. 3"],["g","Gravity","m/s²","e.g. 9.81"]],rows=[["Distance","0.5*g*t*t","m"],["Velocity","g*t","m/s"]],note="d = ½gt²; v = gt.")
T(slug="angular-velocity",name="Angular Velocity",cat="Math",icon="📐",desc="Angular velocity in rad/s from an angular displacement (degrees) and time.",fields=[["ang","Angle","deg","e.g. 360"],["t","Time","s","e.g. 2"]],rows=[["Angular velocity","ang*Math.PI/180/t","rad/s"]],note="ω = θ_rad / t.")
T(slug="rotational-kinetic-energy",name="Rotational Kinetic Energy",cat="Math",icon="📐",desc="Rotational kinetic energy from moment of inertia and angular velocity.",fields=[["I","Moment of inertia","kg·m²","e.g. 0.5"],["w","Angular velocity","rad/s","e.g. 10"]],rows=[["Energy","0.5*I*w*w","J"]],note="KE = ½Iω².")
T(slug="specific-heat-energy",name="Specific Heat Energy",cat="Math",icon="📐",desc="Heat required to raise a mass by a temperature difference using specific heat capacity.",fields=[["m","Mass","kg","e.g. 2"],["c","Specific heat","J/(kg·K)","e.g. 4186"],["dT","Temp difference","K","e.g. 10"]],rows=[["Heat","m*c*dT","J"]],note="Q = mcΔT.")
T(slug="latent-heat-energy",name="Latent Heat Energy",cat="Math",icon="📐",desc="Energy absorbed or released during a phase change from mass and latent heat.",fields=[["m","Mass","kg","e.g. 1"],["L","Latent heat","J/kg","e.g. 334000"]],rows=[["Energy","m*L","J"]],note="Q = mL.")
T(slug="youngs-modulus",name="Young's Modulus",cat="Math",icon="📐",desc="Young's modulus, stress, and strain from force, area, original length, and extension.",fields=[["F","Force","N","e.g. 1000"],["A","Area","m²","e.g. 0.001"],["dL","Extension","m","e.g. 0.002"],["L","Original length","m","e.g. 2"]],rows=[["Stress","F/A","Pa"],["Strain","dL/L",""],["Young's modulus","(F/A)/(dL/L)","Pa"]],note="Y = stress/strain.")
T(slug="snell-refractive-index",name="Snell Refractive Index",cat="Math",icon="📐",desc="Relative refractive index from incident and refracted angles (degrees).",fields=[["a1","Incident angle","deg","e.g. 45"],["a2","Refracted angle","deg","e.g. 30"]],rows=[["Refractive index","Math.sin(a1*Math.PI/180)/Math.sin(a2*Math.PI/180)",""]],note="n = sin(θ1)/sin(θ2).")
T(slug="buoyant-force",name="Buoyant Force",cat="Math",icon="📐",desc="Buoyant force on a submerged volume from fluid density and gravity.",fields=[["rho","Fluid density","kg/m³","e.g. 1000"],["V","Volume","m³","e.g. 0.01"],["g","Gravity","m/s²","e.g. 9.81"]],rows=[["Buoyant force","rho*V*g","N"]],note="F = ρVg.")
T(slug="escape-velocity",name="Escape Velocity",cat="Math",icon="🔭",desc="Escape velocity from a body of given mass and radius.",fields=[["M","Mass","kg","e.g. 5.972e24"],["R","Radius","m","e.g. 6.371e6"]],rows=[["Escape velocity","Math.sqrt(2*6.674e-11*M/R)","m/s"]],note="v = √(2GM/R), G = 6.674e-11.")
T(slug="orbital-period",name="Orbital Period",cat="Math",icon="🔭",desc="Orbital period of a small body around a central mass at a given orbital radius.",fields=[["M","Central mass","kg","e.g. 5.972e24"],["a","Orbital radius","m","e.g. 6.771e6"]],rows=[["Period","2*Math.PI*Math.sqrt(a*a*a/(6.674e-11*M))","s"]],note="T = 2π√(a³/GM).")
T(slug="gravitational-force",name="Gravitational Force",cat="Math",icon="🔭",desc="Newtonian gravitational attraction between two masses separated by a distance.",fields=[["m1","Mass 1","kg","e.g. 5.972e24"],["m2","Mass 2","kg","e.g. 7.342e22"],["r","Distance","m","e.g. 3.844e8"]],rows=[["Force","6.674e-11*m1*m2/(r*r)","N"]],note="F = G m1m2/r².")
T(slug="schwarzschild-radius",name="Schwarzschild Radius",cat="Math",icon="🔭",desc="Schwarzschild radius (event horizon) of a non-rotating mass.",fields=[["M","Mass","kg","e.g. 5.972e24"]],rows=[["Radius","2*6.674e-11*M/(3e8*3e8)","m"]],note="r_s = 2GM/c², c = 3e8 m/s.")
T(slug="stefan-luminosity",name="Star Luminosity (Stefan-Boltzmann)",cat="Math",icon="🔭",desc="Total luminosity of a blackbody sphere from its radius and surface temperature.",fields=[["R","Radius","m","e.g. 6.96e8"],["T","Temperature","K","e.g. 5778"]],rows=[["Luminosity","4*Math.PI*R*R*5.67e-8*Math.pow(T,4)","W"]],note="L = 4πR²σT⁴, σ = 5.67e-8.")
T(slug="angular-size",name="Angular Size",cat="Math",icon="🔭",desc="Apparent angular size in arcseconds from an object's size and its distance.",fields=[["size","Object size","m","e.g. 1000"],["dist","Distance","m","e.g. 1e8"]],rows=[["Angular size","size/dist*206265","arcsec"]],note="θ ≈ size/distance · 206265 arcsec.")
T(slug="light-travel-time",name="Light Travel Time",cat="Math",icon="🔭",desc="Time for light to cross a distance, in seconds and in years.",fields=[["dist","Distance","m","e.g. 9.461e15"]],rows=[["Time","dist/3e8","s"],["Years","dist/3e8/31557600","y"]],note="t = d/c, c = 3e8 m/s.")
T(slug="planetary-weight",name="Weight on a Body",cat="Math",icon="🔭",desc="Weight (force) of a mass in a gravitational field of given strength.",fields=[["m","Mass","kg","e.g. 70"],["g","Gravity","m/s²","e.g. 9.81"]],rows=[["Weight","m*g","N"]],note="W = mg.")
T(slug="debroglie-wavelength",name="de Broglie Wavelength",cat="Math",icon="🔭",desc="de Broglie wavelength of a particle from its mass and velocity.",fields=[["m","Mass","kg","e.g. 9.109e-31"],["v","Velocity","m/s","e.g. 1e6"]],rows=[["Wavelength","6.626e-34/(m*v)","m"]],note="λ = h/(mv), h = 6.626e-34 J·s.")
T(slug="acoustic-impedance",name="Acoustic Impedance",cat="Audio",icon="🎵",desc="Acoustic impedance of a medium from its density and speed of sound.",fields=[["rho","Density","kg/m³","e.g. 1000"],["c","Sound speed","m/s","e.g. 1480"]],rows=[["Impedance","rho*c","Pa·s/m"]],note="Z = ρc.")
T(slug="decibel-power-ratio",name="Decibel Power Ratio",cat="Audio",icon="🎵",desc="Decibel gain between two power levels.",fields=[["P1","Power 1","W","e.g. 100"],["P2","Power 2","W","e.g. 1"]],rows=[["Level difference","10*Math.log(P1/P2)/Math.log(10)","dB"]],note="L = 10 log10(P1/P2).")
T(slug="sound-intensity-level",name="Sound Intensity Level",cat="Audio",icon="🎵",desc="Sound intensity level in dB relative to a reference intensity.",fields=[["I","Intensity","W/m²","e.g. 0.001"],["I0","Reference","W/m²","e.g. 1e-12"]],rows=[["Level","10*Math.log(I/I0)/Math.log(10)","dB"]],note="L = 10 log10(I/I0).")
T(slug="terminal-velocity",name="Terminal Velocity",cat="Math",icon="📐",desc="Terminal velocity of a falling object from mass, drag coefficient, area, and fluid density.",fields=[["m","Mass","kg","e.g. 70"],["g","Gravity","m/s²","e.g. 9.81"],["rho","Fluid density","kg/m³","e.g. 1.225"],["Cd","Drag coeff","","e.g. 1"],["A","Area","m²","e.g. 0.7"]],rows=[["Terminal velocity","Math.sqrt(2*m*g/(rho*Cd*A))","m/s"]],note="v = √(2mg/(ρCdA)).")

# === Physics: fluids ===
T(slug="hydrostatic-pressure",name="Hydrostatic Pressure",cat="Math",icon="📐",desc="Pressure at a depth in a static fluid from fluid density, depth, and gravity.",fields=[["rho","Density","kg/m³","e.g. 1000"],["h","Depth","m","e.g. 10"],["g","Gravity","m/s²","e.g. 9.81"]],rows=[["Pressure","rho*g*h","Pa"]],note="P = ρgh.")
T(slug="capillary-rise",name="Capillary Rise",cat="Math",icon="📐",desc="Height of capillary rise in a tube from surface tension, contact angle, density, and tube radius.",fields=[["gamma","Surface tension","N/m","e.g. 0.072"],["ang","Contact angle","deg","e.g. 0"],["rho","Density","kg/m³","e.g. 1000"],["r","Tube radius","m","e.g. 0.0005"]],rows=[["Rise height","2*gamma*Math.cos(ang*Math.PI/180)/(rho*9.81*r)","m"]],note="h = 2γcosθ/(ρgr).")
T(slug="reynolds-number",name="Reynolds Number",cat="Math",icon="📐",desc="Reynolds number for flow from density, velocity, length, and dynamic viscosity.",fields=[["rho","Density","kg/m³","e.g. 1000"],["v","Velocity","m/s","e.g. 1"],["L","Length","m","e.g. 0.05"],["mu","Viscosity","Pa·s","e.g. 0.001"]],rows=[["Reynolds number","rho*v*L/mu",""]],note="Re = ρvL/μ.")
T(slug="bernoulli-pressure",name="Bernoulli Pressure",cat="Math",icon="📐",desc="Downstream pressure from Bernoulli's principle given upstream pressure and two velocities.",fields=[["rho","Density","kg/m³","e.g. 1.225"],["v1","Velocity 1","m/s","e.g. 10"],["v2","Velocity 2","m/s","e.g. 20"],["P1","Pressure 1","Pa","e.g. 101325"]],rows=[["Pressure 2","P1+0.5*rho*(v1*v1-v2*v2)","Pa"]],note="P1 + ½ρv1² = P2 + ½ρv2².")

# === Finance ===
T(slug="present-value-lump-sum",name="Present Value (Lump Sum)",cat="Finance",icon="💰",desc="Present value of a future lump sum discounted at a periodic rate over n periods.",fields=[["FV","Future value","$","e.g. 10000"],["r","Rate per period","","e.g. 0.05"],["n","Periods","","e.g. 10"]],rows=[["Present value","FV/Math.pow(1+r,n)","$"]],note="PV = FV/(1+r)ⁿ.")
T(slug="future-value-lump-sum",name="Future Value (Lump Sum)",cat="Finance",icon="💰",desc="Future value of a present amount compounded at a periodic rate over n periods.",fields=[["PV","Present value","$","e.g. 1000"],["r","Rate per period","","e.g. 0.05"],["n","Periods","","e.g. 10"]],rows=[["Future value","PV*Math.pow(1+r,n)","$"]],note="FV = PV(1+r)ⁿ.")
T(slug="future-value-annuity",name="Future Value of an Annuity",cat="Finance",icon="💰",desc="Future value of a series of equal periodic payments at a periodic rate.",fields=[["PMT","Payment","$","e.g. 100"],["r","Rate per period","","e.g. 0.05"],["n","Periods","","e.g. 10"]],rows=[["Future value","PMT*((Math.pow(1+r,n)-1)/r)","$"]],note="FV = PMT·((1+r)ⁿ−1)/r.")
T(slug="present-value-annuity",name="Present Value of an Annuity",cat="Finance",icon="💰",desc="Present value of a series of equal periodic payments at a periodic rate.",fields=[["PMT","Payment","$","e.g. 100"],["r","Rate per period","","e.g. 0.05"],["n","Periods","","e.g. 10"]],rows=[["Present value","PMT*(1-Math.pow(1+r,-n))/r","$"]],note="PV = PMT·(1−(1+r)⁻ⁿ)/r.")
T(slug="straight-line-depreciation",name="Straight-Line Depreciation",cat="Finance",icon="💰",desc="Annual depreciation and total depreciable amount from cost, salvage value, and useful life.",fields=[["cost","Cost","$","e.g. 50000"],["salvage","Salvage","$","e.g. 5000"],["life","Life","years","e.g. 5"]],rows=[["Annual depreciation","(cost-salvage)/life","$/yr"],["Total depreciable","cost-salvage","$"]],note="Dep = (cost − salvage)/life.")
T(slug="declining-balance-depreciation",name="Declining Balance Depreciation",cat="Finance",icon="💰",desc="First-year depreciation under the declining-balance method from book value and rate.",fields=[["book","Book value","$","e.g. 50000"],["rate","Rate","","e.g. 0.4"]],rows=[["Depreciation","book*rate","$"],["Ending book value","book*(1-rate)","$"]],note="Dep = book · rate.")
T(slug="cap-rate",name="Cap Rate",cat="Finance",icon="💰",desc="Capitalization rate from net operating income and property value.",fields=[["noi","Net operating income","$/yr","e.g. 24000"],["price","Property value","$","e.g. 300000"]],rows=[["Cap rate","noi/price*100","%"]],note="Cap = NOI / value.")
T(slug="dividend-yield",name="Dividend Yield",cat="Finance",icon="💰",desc="Dividend yield from annual dividends per share and price per share.",fields=[["div","Annual dividend","$","e.g. 4"],["price","Price","$","e.g. 80"]],rows=[["Yield","div/price*100","%"]],note="Yield = dividend / price.")
T(slug="gross-margin",name="Gross Margin & Markup",cat="Finance",icon="💰",desc="Gross margin and markup percentage from selling price and unit cost.",fields=[["price","Price","$","e.g. 50"],["cost","Cost","$","e.g. 30"]],rows=[["Gross margin","(price-cost)/price*100","%"],["Markup","(price-cost)/cost*100","%"]],note="Margin = (price−cost)/price; markup = (price−cost)/cost.")
T(slug="markup-price",name="Markup Price",cat="Finance",icon="💰",desc="Selling price from unit cost and a markup percentage.",fields=[["cost","Cost","$","e.g. 30"],["mu","Markup","%","e.g. 40"]],rows=[["Price","cost*(1+mu/100)","$"]],note="Price = cost · (1 + markup%).")
T(slug="break-even-units",name="Break-Even Units",cat="Finance",icon="💰",desc="Number of units to sell to break even from fixed costs, price, and variable cost per unit.",fields=[["fixed","Fixed costs","$","e.g. 10000"],["price","Price/unit","$","e.g. 25"],["vc","Variable cost/unit","$","e.g. 10"]],rows=[["Break-even units","fixed/(price-vc)","units"]],note="Units = fixed / (price − variable cost).")
T(slug="rule-of-72",name="Rule of 72",cat="Finance",icon="💰",desc="Years to double an investment using the rule of 72 and the exact logarithmic value.",fields=[["rate","Annual rate","%","e.g. 6"]],rows=[["Doubling time (rule)","72/rate","yrs"],["Doubling time (exact)","Math.log(2)/Math.log(1+rate/100)","yrs"]],note="Rule: 72/rate; exact: ln2/ln(1+r).")
T(slug="effective-annual-rate",name="Effective Annual Rate",cat="Finance",icon="💰",desc="Effective annual rate from a nominal rate and compounding periods per year.",fields=[["nominal","Nominal rate","%","e.g. 12"],["n","Periods/yr","","e.g. 12"]],rows=[["Effective rate","(Math.pow(1+nominal/100/n,n)-1)*100","%"]],note="EAR = (1 + r/n)ⁿ − 1.")
T(slug="inflation-future-cost",name="Inflation Future Cost",cat="Finance",icon="💰",desc="Future cost of an item after years of inflation at a constant annual rate.",fields=[["present","Present cost","$","e.g. 100"],["infl","Inflation","%","e.g. 3"],["n","Years","","e.g. 10"]],rows=[["Future cost","present*Math.pow(1+infl/100,n)","$"]],note="FV = PV(1+i)ⁿ.")
T(slug="price-elasticity",name="Price Elasticity of Demand",cat="Finance",icon="💰",desc="Price elasticity of demand from percentage change in quantity and price.",fields=[["pctQ","% change quantity","","e.g. -10"],["pctP","% change price","","e.g. 5"]],rows=[["Elasticity","pctQ/pctP",""]],note="E = %ΔQ / %ΔP.")
T(slug="cash-on-cash-return",name="Cash-on-Cash Return",cat="Finance",icon="💰",desc="Cash-on-cash return from annual cash flow and cash invested.",fields=[["cf","Annual cash flow","$","e.g. 12000"],["inv","Cash invested","$","e.g. 100000"]],rows=[["Return","cf/inv*100","%"]],note="CoC = annual cash flow / invested.")
T(slug="simple-interest",name="Simple Interest",cat="Finance",icon="💰",desc="Interest and total amount owed under simple interest from principal, rate, and time.",fields=[["P","Principal","$","e.g. 1000"],["r","Rate","%","e.g. 5"],["t","Time","years","e.g. 3"]],rows=[["Interest","P*r/100*t","$"],["Total","P*(1+r/100*t)","$"]],note="I = Prt.")
T(slug="compound-annual-growth-rate",name="Compound Annual Growth Rate",cat="Finance",icon="💰",desc="CAGR from beginning value, ending value, and number of periods.",fields=[["begin","Beginning value","$","e.g. 1000"],["end","Ending value","$","e.g. 1500"],["n","Periods","","e.g. 5"]],rows=[["CAGR","(Math.pow(end/begin,1/n)-1)*100","%"]],note="CAGR = (end/begin)^(1/n) − 1.")
T(slug="discount-factor",name="Discount Factor",cat="Finance",icon="💰",desc="Present-value discount factor for a rate and number of periods.",fields=[["r","Rate per period","","e.g. 0.05"],["n","Periods","","e.g. 10"]],rows=[["Discount factor","1/Math.pow(1+r,n)",""]],note="DF = 1/(1+r)ⁿ.")
T(slug="perpetuity-value",name="Perpetuity Present Value",cat="Finance",icon="💰",desc="Present value of a perpetuity from the periodic payment and discount rate.",fields=[["PMT","Payment","$","e.g. 100"],["r","Rate per period","","e.g. 0.05"]],rows=[["Present value","PMT/r","$"]],note="PV = PMT/r.")
T(slug="debt-to-income-ratio",name="Debt-to-Income Ratio",cat="Finance",icon="💰",desc="Debt-to-income ratio from monthly debt payments and gross monthly income.",fields=[["debt","Monthly debt","$","e.g. 1500"],["income","Monthly income","$","e.g. 5000"]],rows=[["DTI","debt/income*100","%"]],note="DTI = debt / income.")
T(slug="loan-to-value-ratio",name="Loan-to-Value Ratio",cat="Finance",icon="💰",desc="Loan-to-value ratio from loan amount and appraised property value.",fields=[["loan","Loan amount","$","e.g. 180000"],["value","Property value","$","e.g. 200000"]],rows=[["LTV","loan/value*100","%"]],note="LTV = loan / value.")

# === Construction / Materials ===
T(slug="concrete-column-volume",name="Concrete Column Volume",cat="Productivity",icon="✅",desc="Volume of a cylindrical concrete column from its diameter and height.",fields=[["d","Diameter","m","e.g. 0.3"],["h","Height","m","e.g. 3"]],rows=[["Volume","Math.PI*(d/2)*(d/2)*h","m³"]],note="V = πr²h.")
T(slug="excavation-volume",name="Excavation Volume",cat="Productivity",icon="✅",desc="Volume of material to excavate from length, width, and depth.",fields=[["l","Length","m","e.g. 10"],["w","Width","m","e.g. 4"],["d","Depth","m","e.g. 1.5"]],rows=[["Volume","l*w*d","m³"]],note="V = l·w·d.")
T(slug="slope-percentage",name="Slope Percentage",cat="Productivity",icon="✅",desc="Slope percentage and the 1-in-n ratio from vertical rise and horizontal run.",fields=[["rise","Rise","m","e.g. 1.5"],["run","Run","m","e.g. 20"]],rows=[["Slope","rise/run*100","%"],["Ratio 1-in","run/rise",""]],note="Slope% = rise/run · 100.")
T(slug="staircase-riser-count",name="Staircase Riser Count",cat="Productivity",icon="✅",desc="Number of risers and the tread-run total from total height and riser height.",fields=[["H","Total height","m","e.g. 2.7"],["rh","Riser height","m","e.g. 0.18"]],rows=[["Risers","Math.ceil(H/rh)",""],["Tread run total","Math.ceil(H/rh)*0.28","m"]],note="Risers = ceil(H / riser height).")
T(slug="drywall-sheet-count",name="Drywall Sheet Count",cat="Productivity",icon="✅",desc="Number of 4×8 ft drywall sheets needed for a wall area with a waste factor.",fields=[["area","Wall area","ft²","e.g. 400"],["waste","Waste","%","e.g. 10"]],rows=[["Sheets","Math.ceil(area/32*(1+waste/100))","sheets"]],note="1 sheet = 32 ft² (4×8).")
T(slug="tile-quantity",name="Tile Quantity",cat="Productivity",icon="✅",desc="Number of tiles needed for an area given tile size and a waste percentage.",fields=[["area","Area","m²","e.g. 20"],["tw","Tile width","m","e.g. 0.3"],["th","Tile height","m","e.g. 0.3"],["waste","Waste","%","e.g. 10"]],rows=[["Tiles","Math.ceil(area/(tw*th)*(1+waste/100))","tiles"]],note="Tiles = area / (tw·th) · (1 + waste%).")
T(slug="roofing-bundle-count",name="Roofing Bundle Count",cat="Productivity",icon="✅",desc="Bundles of shingles needed for a roof area at 33 ft² per bundle with waste.",fields=[["area","Roof area","ft²","e.g. 1000"],["waste","Waste","%","e.g. 10"]],rows=[["Bundles","Math.ceil(area/33*(1+waste/100))","bundles"]],note="≈33 ft² per bundle.")
T(slug="insulation-r-value-add",name="Insulation Total R-Value",cat="Productivity",icon="✅",desc="Total R-value of up to three insulation layers added in series.",fields=[["r1","Layer 1 R","","e.g. 13"],["r2","Layer 2 R","","e.g. 5"],["r3","Layer 3 R","","e.g. 0"]],rows=[["Total R-value","r1+r2+r3",""]],note="R-values add in series.")
T(slug="gravel-tonnage",name="Gravel Tonnage",cat="Productivity",icon="✅",desc="Tonnage of gravel from volume and bulk density.",fields=[["vol","Volume","m³","e.g. 5"],["rho","Density","t/m³","e.g. 1.6"]],rows=[["Tonnes","vol*rho","t"]],note="Mass = volume · density.")
T(slug="rebar-weight",name="Rebar Weight",cat="Productivity",icon="✅",desc="Weight of a rebar bar from its diameter and length using the d²/162 rule (kg/m).",fields=[["d","Diameter","mm","e.g. 16"],["L","Length","m","e.g. 12"]],rows=[["Weight","d*d/162*L","kg"]],note="≈ d²/162 kg per metre (metric).")
T(slug="wallpaper-roll-count",name="Wallpaper Roll Count",cat="Productivity",icon="✅",desc="Number of wallpaper rolls needed from wall area, roll coverage, and pattern repeat.",fields=[["area","Wall area","ft²","e.g. 400"],["roll","Roll coverage","ft²","e.g. 56"],["repeat","Pattern repeat","%","e.g. 10"]],rows=[["Rolls","Math.ceil(area/roll*(1+repeat/100))","rolls"]],note="Accounts for pattern-repeat waste.")
T(slug="brick-quantity",name="Brick Quantity",cat="Productivity",icon="✅",desc="Number of bricks for a wall from wall area, brick face area, and a waste allowance.",fields=[["area","Wall area","m²","e.g. 10"],["bw","Brick width","m","e.g. 0.2"],["bh","Brick height","m","e.g. 0.075"],["waste","Waste","%","e.g. 5"]],rows=[["Bricks","Math.ceil(area/(bw*bh)*(1+waste/100))","bricks"]],note="Bricks = wall area / brick face area.")
T(slug="siding-squares",name="Siding Squares",cat="Productivity",icon="✅",desc="Number of siding squares (1 square = 100 ft²) from wall area with a waste factor.",fields=[["area","Wall area","ft²","e.g. 1200"],["waste","Waste","%","e.g. 10"]],rows=[["Squares","Math.ceil(area/100*(1+waste/100))","squares"]],note="1 square = 100 ft².")
T(slug="roof-slope-multiplier",name="Roof Slope Multiplier",cat="Productivity",icon="✅",desc="Roof area multiplier from rise and run to convert plan area to sloped area.",fields=[["rise","Rise","m","e.g. 3"],["run","Run","m","e.g. 12"]],rows=[["Multiplier","Math.sqrt(rise*rise+run*run)/run",""],["Slope length","Math.sqrt(rise*rise+run*run)","m"]],note="Sloped length = √(rise²+run²).")
T(slug="concrete-bag-count",name="Concrete Bag Count",cat="Productivity",icon="✅",desc="Number of premixed concrete bags from required volume and bag yield.",fields=[["vol","Volume","m³","e.g. 0.5"],["y","Yield per bag","m³","e.g. 0.01"]],rows=[["Bags","Math.ceil(vol/y)","bags"]],note="Bags = volume / yield per bag.")

# === Hydraulics / Fluids ===
T(slug="mannings-flow",name="Manning's Flow",cat="Environment",icon="🌍",desc="Open-channel flow rate from area, hydraulic radius, slope, and Manning's n.",fields=[["n","Manning n","","e.g. 0.013"],["A","Area","m²","e.g. 2"],["R","Hydraulic radius","m","e.g. 0.5"],["S","Slope","","e.g. 0.001"]],rows=[["Flow rate","A/n*Math.pow(R,2/3)*Math.sqrt(S)","m³/s"]],note="Q = (A/n) R^(2/3) S^(1/2).")
T(slug="orifice-flow-rate",name="Orifice Flow Rate",cat="Environment",icon="🌍",desc="Flow rate through a sharp-edged orifice from coefficient, diameter, and head.",fields=[["Cd","Discharge coeff","","e.g. 0.62"],["d","Diameter","m","e.g. 0.05"],["h","Head","m","e.g. 2"]],rows=[["Flow rate","Cd*Math.PI*(d/2)*(d/2)*Math.sqrt(2*9.81*h)","m³/s"]],note="Q = Cd·A·√(2gh).")
T(slug="rectangular-weir-flow",name="Rectangular Weir Flow",cat="Environment",icon="🌍",desc="Flow rate over a rectangular weir from crest width and head above the crest.",fields=[["Cd","Discharge coeff","","e.g. 0.62"],["b","Crest width","m","e.g. 1"],["h","Head","m","e.g. 0.3"]],rows=[["Flow rate","2/3*Cd*b*Math.sqrt(2*9.81)*Math.pow(h,1.5)","m³/s"]],note="Q = 2/3 Cd·b·√(2g)·h^1.5.")
T(slug="pipe-flow-velocity",name="Pipe Flow Velocity",cat="Environment",icon="🌍",desc="Mean velocity in a full pipe from flow rate and pipe diameter.",fields=[["Q","Flow rate","m³/s","e.g. 0.01"],["d","Diameter","m","e.g. 0.1"]],rows=[["Velocity","Q/(Math.PI*(d/2)*(d/2))","m/s"]],note="v = Q/A.")
T(slug="hydrostatic-force-wall",name="Hydrostatic Force on Wall",cat="Environment",icon="🌍",desc="Total hydrostatic force on a vertical wall from fluid density, depth, and wall width.",fields=[["rho","Density","kg/m³","e.g. 1000"],["h","Depth","m","e.g. 3"],["w","Wall width","m","e.g. 2"]],rows=[["Force","0.5*rho*9.81*h*h*w","N"]],note="F = ½ρg·h²·w (acts at 2h/3).")
T(slug="pitot-tube-velocity",name="Pitot Tube Velocity",cat="Environment",icon="🌍",desc="Flow velocity from a Pitot tube differential pressure and fluid density.",fields=[["rho","Density","kg/m³","e.g. 1.225"],["dP","Diff pressure","Pa","e.g. 100"]],rows=[["Velocity","Math.sqrt(2*dP/rho)","m/s"]],note="v = √(2ΔP/ρ).")
T(slug="pump-power",name="Pump Power",cat="Environment",icon="🌍",desc="Hydraulic pump power from fluid density, flow, head, and efficiency.",fields=[["rho","Density","kg/m³","e.g. 1000"],["Q","Flow","m³/s","e.g. 0.01"],["H","Head","m","e.g. 20"],["eta","Efficiency","","e.g. 0.7"]],rows=[["Power","rho*9.81*Q*H/eta","W"]],note="P = ρgQH/η.")
T(slug="bernoulli-efflux-velocity",name="Bernoulli Efflux Velocity",cat="Environment",icon="🌍",desc="Efflux velocity of a fluid leaving a tank under a given head (Torricelli's law).",fields=[["h","Head","m","e.g. 3"]],rows=[["Velocity","Math.sqrt(2*9.81*h)","m/s"]],note="v = √(2gh).")
T(slug="hydraulic-radius",name="Hydraulic Radius",cat="Environment",icon="🌍",desc="Hydraulic radius of a channel from its flow area and wetted perimeter.",fields=[["A","Area","m²","e.g. 2"],["P","Wetted perimeter","m","e.g. 4"]],rows=[["Hydraulic radius","A/P","m"]],note="R = A/P.")
T(slug="specific-gravity",name="Specific Gravity",cat="Environment",icon="🌍",desc="Specific gravity of a substance from its density and a reference density (water).",fields=[["rho","Density","kg/m³","e.g. 800"],["rw","Reference","kg/m³","e.g. 1000"]],rows=[["Specific gravity","rho/rw",""]],note="SG = ρ/ρ_water.")
T(slug="flow-rate-velocity-area",name="Flow Rate from Velocity",cat="Environment",icon="🌍",desc="Volumetric flow rate from cross-sectional area and velocity.",fields=[["A","Area","m²","e.g. 0.05"],["v","Velocity","m/s","e.g. 2"]],rows=[["Flow rate","A*v","m³/s"]],note="Q = A·v.")

# === Pneumatics / HVAC / Lighting ===
T(slug="pneumatic-cylinder-force",name="Pneumatic Cylinder Force",cat="Environment",icon="🌍",desc="Force from a pneumatic cylinder from air pressure and piston area.",fields=[["P","Pressure","Pa","e.g. 600000"],["A","Piston area","m²","e.g. 0.005"]],rows=[["Force","P*A","N"]],note="F = P·A.")
T(slug="pneumatic-air-consumption",name="Pneumatic Air Consumption",cat="Environment",icon="🌍",desc="Air volume consumed per cycle from piston area, stroke, and number of cycles.",fields=[["A","Piston area","m²","e.g. 0.005"],["s","Stroke","m","e.g. 0.1"],["c","Cycles","","e.g. 60"]],rows=[["Air consumed","A*s*c","m³"]],note="V = A·stroke·cycles.")
T(slug="hvac-cooling-load",name="HVAC Cooling Load",cat="Environment",icon="🌍",desc="Quick cooling load estimate from floor area and a watts-per-area factor.",fields=[["area","Area","m²","e.g. 50"],["factor","W/m²","W/m²","e.g. 120"]],rows=[["Cooling load","area*factor","W"]],note="Load = area · W/m².")
T(slug="air-changes-per-hour",name="Air Changes per Hour",cat="Environment",icon="🌍",desc="Air change rate from supply airflow (CFM) and room volume.",fields=[["cfm","Airflow","ft³/min","e.g. 200"],["vol","Room volume","ft³","e.g. 2000"]],rows=[["ACH","cfm*60/vol","/hr"]],note="ACH = CFM·60 / volume.")
T(slug="duct-velocity",name="Duct Velocity",cat="Environment",icon="🌍",desc="Air velocity in a duct from airflow (CFM) and duct cross-sectional area.",fields=[["cfm","Airflow","ft³/min","e.g. 400"],["A","Area","ft²","e.g. 2"]],rows=[["Velocity","cfm/A","ft/min"]],note="v = CFM / area.")
T(slug="lux-from-lumens",name="Lux from Lumens",cat="Environment",icon="🌍",desc="Illuminance in lux from total luminous flux and the lit area.",fields=[["lumens","Luminous flux","lm","e.g. 8000"],["A","Area","m²","e.g. 20"]],rows=[["Illuminance","lumens/A","lx"]],note="lux = lumens / m².")
T(slug="watts-to-lumens",name="Watts to Lumens",cat="Environment",icon="🌍",desc="Luminous flux in lumens from electrical power and luminous efficacy.",fields=[["w","Power","W","e.g. 10"],["eff","Efficacy","lm/W","e.g. 90"]],rows=[["Lumens","w*eff","lm"]],note="lumens = watts · efficacy.")

# === Machining / Metalworking / Welding ===
T(slug="spindle-speed-rpm",name="Spindle Speed (RPM)",cat="Productivity",icon="✅",desc="Spindle speed in RPM from cutting speed and cutter diameter.",fields=[["cs","Cutting speed","m/min","e.g. 200"],["d","Diameter","mm","e.g. 10"]],rows=[["RPM","1000*cs/(Math.PI*d)","rpm"]],note="n = 1000·v / (π·d).")
T(slug="machining-feed-rate",name="Machining Feed Rate",cat="Productivity",icon="✅",desc="Feed rate in mm/min from spindle speed, flute count, and chip load per tooth.",fields=[["rpm","Spindle speed","rpm","e.g. 8000"],["z","Flutes","","e.g. 2"],["fz","Chip load","mm","e.g. 0.05"]],rows=[["Feed rate","rpm*z*fz","mm/min"]],note="F = rpm · z · fz.")
T(slug="drilling-feed-rate",name="Drilling Feed Rate",cat="Productivity",icon="✅",desc="Drilling feed rate in mm/min from spindle speed and feed per revolution.",fields=[["rpm","Spindle speed","rpm","e.g. 1500"],["f","Feed/rev","mm","e.g. 0.15"]],rows=[["Feed rate","rpm*f","mm/min"]],note="F = rpm · f.")
T(slug="material-removal-rate",name="Material Removal Rate",cat="Productivity",icon="✅",desc="Milling material removal rate from cut width, depth, and feed rate.",fields=[["w","Width of cut","mm","e.g. 5"],["d","Depth","mm","e.g. 2"],["f","Feed","mm/min","e.g. 800"]],rows=[["MRR","w*d*f","mm³/min"]],note="MRR = width · depth · feed.")
T(slug="welding-heat-input",name="Welding Heat Input",cat="Productivity",icon="✅",desc="Heat input per unit length from voltage, current, and travel speed.",fields=[["V","Voltage","V","e.g. 25"],["I","Current","A","e.g. 200"],["s","Travel speed","mm/min","e.g. 300"]],rows=[["Heat input","V*I*60/s","J/mm"]],note="HI = V·I·60 / travel speed (mm/min).")
T(slug="welding-fillet-volume",name="Welding Fillet Volume",cat="Productivity",icon="✅",desc="Weld metal volume of a fillet weld from leg sizes and length.",fields=[["z1","Leg 1","mm","e.g. 6"],["z2","Leg 2","mm","e.g. 6"],["L","Length","mm","e.g. 1000"]],rows=[["Volume","0.5*z1*z2*L","mm³"]],note="V = ½·leg1·leg2·length.")
T(slug="lathe-cutting-time",name="Lathe Cutting Time",cat="Productivity",icon="✅",desc="Time to turn a length on a lathe from length, feed per rev, and spindle speed.",fields=[["L","Length","mm","e.g. 100"],["f","Feed/rev","mm","e.g. 0.2"],["rpm","Spindle speed","rpm","e.g. 1000"]],rows=[["Time","L/(f*rpm)","min"]],note="t = L / (f · rpm).")
T(slug="tap-drill-size",name="Tap Drill Size (Metric)",cat="Productivity",icon="✅",desc="Tap drill size for a metric thread from major diameter and pitch.",fields=[["D","Major diameter","mm","e.g. 8"],["P","Pitch","mm","e.g. 1.25"]],rows=[["Tap drill","D-P","mm"]],note="Tap drill = major diameter − pitch.")
T(slug="bolt-circle-spacing",name="Bolt Circle Spacing",cat="Productivity",icon="✅",desc="Arc spacing between bolts on a bolt circle from bolt count and pitch diameter.",fields=[["n","Bolts","","e.g. 6"],["pcd","Pitch circle dia","mm","e.g. 100"]],rows=[["Spacing","pcd*Math.PI/n","mm"]],note="Spacing = π·PCD / n.")
T(slug="drill-point-length",name="Drill Point Length",cat="Productivity",icon="✅",desc="Point length of a drill from its diameter and the point angle.",fields=[["d","Diameter","mm","e.g. 10"],["ang","Point angle","deg","e.g. 118"]],rows=[["Point length","d/2/Math.tan(ang/2*Math.PI/180)","mm"]],note="L = (d/2) / tan(angle/2).")
T(slug="countersink-depth",name="Countersink Depth",cat="Productivity",icon="✅",desc="Countersink depth for a given head diameter and countersink angle.",fields=[["d","Head diameter","mm","e.g. 8"],["ang","Angle","deg","e.g. 82"]],rows=[["Depth","d/2/Math.tan(ang/2*Math.PI/180)","mm"]],note="depth = (d/2) / tan(angle/2).")

# === Sewing / Textiles ===
T(slug="fabric-yardage",name="Fabric Yardage",cat="Productivity",icon="✅",desc="Fabric needed in yards from number of pieces, piece length, and a waste allowance.",fields=[["pieces","Pieces","","e.g. 4"],["len","Piece length","in","e.g. 36"],["waste","Waste","%","e.g. 10"]],rows=[["Yards","pieces*len*(1+waste/100)/36","yd"]],note="Yards = pieces · length · (1+waste%) / 36.")
T(slug="button-spacing",name="Button Spacing",cat="Productivity",icon="✅",desc="Even spacing between buttons from the total length and the button count.",fields=[["L","Length","in","e.g. 30"],["n","Buttons","","e.g. 5"]],rows=[["Spacing","L/(n+1)","in"]],note="Spacing = length / (buttons + 1).")
T(slug="seam-allowance-total",name="Seam Allowance Total",cat="Productivity",icon="✅",desc="Total fabric taken by seam allowances from seam length and allowance per side.",fields=[["L","Seam length","in","e.g. 20"],["a","Allowance/side","in","e.g. 0.5"]],rows=[["Allowance fabric","L*a*2","in²"]],note="Both sides: length · allowance · 2.")
T(slug="bias-binding-length",name="Bias Binding Length",cat="Productivity",icon="✅",desc="Bias binding length needed from the edge perimeter and a waste factor.",fields=[["P","Perimeter","in","e.g. 120"],["waste","Waste","%","e.g. 10"]],rows=[["Length","P*(1+waste/100)","in"]],note="Add waste for joins and corners.")
T(slug="quilt-binding-length",name="Quilt Binding Length",cat="Productivity",icon="✅",desc="Binding strip length from quilt width, length, and joining extra.",fields=[["w","Width","in","e.g. 40"],["L","Length","in","e.g. 60"],["extra","Extra","in","e.g. 12"]],rows=[["Binding length","2*(w+L)+extra","in"]],note="Perimeter plus joining extra.")
T(slug="knitting-stitch-count",name="Knitting Stitch Count",cat="Productivity",icon="✅",desc="Number of stitches to cast on from desired width and stitches-per-inch gauge.",fields=[["w","Width","in","e.g. 20"],["g","Gauge","st/in","e.g. 5"]],rows=[["Stitches","Math.round(w*g)","stitches"]],note="Stitches = width · gauge.")
T(slug="knitting-row-count",name="Knitting Row Count",cat="Productivity",icon="✅",desc="Number of rows to knit from desired length and rows-per-inch gauge.",fields=[["L","Length","in","e.g. 24"],["g","Row gauge","rows/in","e.g. 7"]],rows=[["Rows","Math.round(L*g)","rows"]],note="Rows = length · row gauge.")
T(slug="crochet-yardage-estimator",name="Crochet Yardage Estimator",cat="Productivity",icon="✅",desc="Total yarn yardage from per-project yardage and number of projects.",fields=[["per","Per project","yd","e.g. 220"],["n","Projects","","e.g. 3"]],rows=[["Total yardage","per*n","yd"]],note="Total = per-project · count.")
T(slug="fabric-weight-gsm",name="Fabric Weight (GSM)",cat="Productivity",icon="✅",desc="Fabric weight in g/m² from a sample weight and its dimensions.",fields=[["wt","Weight","g","e.g. 5"],["L","Length","m","e.g. 0.1"],["w","Width","m","e.g. 0.1"]],rows=[["GSM","wt/(L*w)","g/m²"]],note="GSM = weight / area.")

# === Archery ===
T(slug="arrow-kinetic-energy",name="Arrow Kinetic Energy",cat="Fun",icon="🎯",desc="Kinetic energy and momentum of an arrow from mass in grains and speed in fps.",fields=[["m","Mass","gr","e.g. 400"],["v","Speed","fps","e.g. 300"]],rows=[["Kinetic energy","m*v*v/450240","ft-lb"],["Momentum","m*v/225120","lb·s"]],note="KE (ft-lb) = gr·fps² / 450240.")
T(slug="draw-length-estimator",name="Draw Length Estimator",cat="Fun",icon="🎯",desc="Estimated draw length from wingspan using the common wingspan/2.5 rule.",fields=[["span","Wingspan","in","e.g. 70"]],rows=[["Draw length","span/2.5","in"]],note="Draw length ≈ wingspan / 2.5.")
T(slug="arrow-front-of-center",name="Arrow Front of Center",cat="Fun",icon="🎯",desc="Front-of-center balance percentage from point weight and total arrow weight.",fields=[["pw","Point weight","gr","e.g. 100"],["tw","Total weight","gr","e.g. 400"]],rows=[["FOC","pw/tw*100","%"]],note="Simple FOC estimate.")
T(slug="bow-letoff-effective",name="Bow Letoff Effective Weight",cat="Fun",icon="🎯",desc="Holding weight at full draw from peak weight and letoff percentage.",fields=[["peak","Peak weight","lb","e.g. 70"],["letoff","Letoff","%","e.g. 80"]],rows=[["Holding weight","peak*(1-letoff/100)","lb"]],note="Holding = peak · (1 − letoff%).")
T(slug="arrow-trajectory-range",name="Arrow Trajectory Range",cat="Fun",icon="🎯",desc="Horizontal range of an arrow from speed and launch angle (vacuum model).",fields=[["v","Speed","fps","e.g. 300"],["ang","Angle","deg","e.g. 5"]],rows=[["Range","v*v*Math.sin(2*ang*Math.PI/180)/32.17","ft"]],note="Range = v² sin(2θ)/g, g = 32.17 ft/s².")

# === Model rocketry ===
T(slug="rocket-apogee",name="Rocket Apogee Height",cat="Fun",icon="🚀",desc="Apogee height of a projectile from speed and launch angle (vacuum model).",fields=[["v","Speed","m/s","e.g. 100"],["ang","Angle","deg","e.g. 80"]],rows=[["Apogee","Math.pow(v*Math.sin(ang*Math.PI/180),2)/(2*9.81)","m"]],note="H = (v sinθ)² / 2g.")
T(slug="rocket-parachute-size",name="Rocket Parachute Size",cat="Fun",icon="🚀",desc="Parachute diameter for a target descent rate from rocket mass.",fields=[["m","Mass","kg","e.g. 0.5"],["vr","Descent rate","m/s","e.g. 5"],["Cd","Drag coeff","","e.g. 1.5"]],rows=[["Diameter","2*Math.sqrt(2*m*9.81/(Cd*1.225*vr*vr*Math.PI))","m"]],note="D from drag = ½ρCdA·v² = mg.")
T(slug="rocket-delta-v",name="Rocket Delta-V (Tsiolkovsky)",cat="Fun",icon="🚀",desc="Delta-v from specific impulse and initial/final mass (Tsiolkovsky equation).",fields=[["Isp","Specific impulse","s","e.g. 250"],["m0","Initial mass","kg","e.g. 1"],["mf","Final mass","kg","e.g. 0.4"]],rows=[["Delta-v","Isp*9.81*Math.log(m0/mf)","m/s"]],note="Δv = Isp·g·ln(m0/mf).")
T(slug="rocket-burnout-velocity",name="Rocket Burnout Velocity",cat="Fun",icon="🚀",desc="Ideal burnout velocity from thrust, mass, and burn time (no gravity/drag).",fields=[["F","Thrust","N","e.g. 20"],["m","Mass","kg","e.g. 0.5"],["t","Burn time","s","e.g. 2"]],rows=[["Burnout velocity","F/m*t","m/s"]],note="v = (F/m)·t, idealised.")
T(slug="rocket-thrust-to-weight",name="Rocket Thrust-to-Weight",cat="Fun",icon="🚀",desc="Thrust-to-weight ratio from thrust and rocket weight.",fields=[["F","Thrust","N","e.g. 20"],["W","Weight","N","e.g. 6"]],rows=[["T/W ratio","F/W",""]],note="T/W > 1 to lift off.")

# === Scuba diving ===
T(slug="ambient-pressure-depth",name="Ambient Pressure at Depth",cat="Fun",icon="🤿",desc="Ambient pressure in bar at a depth in seawater (≈1 bar per 10 m).",fields=[["d","Depth","m","e.g. 20"]],rows=[["Ambient pressure","1+d/10","bar"]],note="≈ 1 bar per 10 m of seawater.")
T(slug="scuba-gas-consumption",name="Scuba Gas Consumption",cat="Fun",icon="🤿",desc="Gas volume consumed at depth from surface breathing rate and time.",fields=[["d","Depth","m","e.g. 20"],["rate","Surface rate","L/min","e.g. 20"],["t","Time","min","e.g. 30"]],rows=[["Gas used","rate*t*(1+d/10)","L"]],note="Consumption = surface rate · time · ambient pressure.")
T(slug="scuba-tank-volume",name="Scuba Tank Free Gas",cat="Fun",icon="🤿",desc="Free gas volume available from tank water capacity and working pressure.",fields=[["wc","Water capacity","L","e.g. 11.1"],["wp","Working pressure","bar","e.g. 200"]],rows=[["Free gas","wc*wp","L"]],note="Free gas = water capacity · pressure.")
T(slug="scuba-sac-rate",name="Scuba SAC Rate",cat="Fun",icon="🤿",desc="Surface air consumption rate from gas used, depth, and bottom time.",fields=[["used","Gas used","bar","e.g. 60"],["vol","Tank volume","L","e.g. 11.1"],["d","Depth","m","e.g. 20"],["t","Time","min","e.g. 30"]],rows=[["SAC rate","used*vol/((1+d/10)*t)","L/min"]],note="SAC = used · tank / (pressure · time).")

# === Pottery ===
T(slug="clay-shrinkage",name="Clay Shrinkage",cat="Fun",icon="🏺",desc="Fired size of a clay piece from wet size and the shrinkage percentage.",fields=[["wet","Wet size","cm","e.g. 10"],["shrink","Shrinkage","%","e.g. 12"]],rows=[["Fired size","wet*(1-shrink/100)","cm"]],note="Fired = wet · (1 − shrink%).")
T(slug="glaze-batch-amount",name="Glaze Batch Amount",cat="Fun",icon="🏺",desc="Amount of a glaze component from total batch size and the component percentage.",fields=[["total","Batch total","g","e.g. 1000"],["pct","Component","%","e.g. 25"]],rows=[["Amount","total*pct/100","g"]],note="Component = total · percent / 100.")
T(slug="kiln-firing-cost",name="Kiln Firing Cost",cat="Fun",icon="🏺",desc="Cost of a kiln firing from power, run time, and electricity rate.",fields=[["kw","Power","kW","e.g. 10"],["t","Time","hours","e.g. 8"],["rate","Rate","$/kWh","e.g. 0.15"]],rows=[["Energy","kw*t","kWh"],["Cost","kw*t*rate","$"]],note="Cost = kW · hours · rate.")
T(slug="thrown-cylinder-volume",name="Thrown Cylinder Volume",cat="Fun",icon="🏺",desc="Clay volume of a thrown cylinder from diameter and height.",fields=[["d","Diameter","cm","e.g. 10"],["h","Height","cm","e.g. 15"]],rows=[["Volume","Math.PI*(d/2)*(d/2)*h","cm³"]],note="V = πr²h.")
T(slug="clay-weight-needed",name="Clay Weight Needed",cat="Fun",icon="🏺",desc="Clay weight from required volume and clay density.",fields=[["vol","Volume","cm³","e.g. 500"],["rho","Density","g/cm³","e.g. 1.8"]],rows=[["Weight","vol*rho","g"]],note="Weight = volume · density.")

# === Climbing ===
T(slug="climbing-fall-factor",name="Climbing Fall Factor",cat="Fun",icon="🧗",desc="Fall factor from fall length and the amount of rope out.",fields=[["fl","Fall length","m","e.g. 4"],["rope","Rope out","m","e.g. 10"]],rows=[["Fall factor","fl/rope",""]],note="Fall factor = fall length / rope out (0–2).")
T(slug="climbing-rope-length",name="Climbing Rope Length Needed",cat="Fun",icon="🧗",desc="Minimum rope length for a single-pitch route from route height.",fields=[["h","Route height","m","e.g. 25"]],rows=[["Rope length","h*2+10","m"]],note="Allow for descent and knotting.")
T(slug="climbing-pulley-advantage",name="Climbing Pulley Advantage",cat="Fun",icon="🧗",desc="Force needed to hold a load with a simple pulley system of given count.",fields=[["load","Load","N","e.g. 800"],["pulleys","Pulleys","","e.g. 2"]],rows=[["Holding force","load/pulleys","N"]],note="Simple system: MA ≈ pulley count.")
T(slug="climbing-rope-tension",name="Climbing Rope Tension",cat="Fun",icon="🧗",desc="Tension in each strand holding a load over a V angle (vector components).",fields=[["load","Load","N","e.g. 800"],["ang","V angle","deg","e.g. 120"]],rows=[["Tension","load/(2*Math.sin(ang/2*Math.PI/180))","N"]],note="T = load / (2 sin(θ/2)).")

# === RPG / gaming ===
T(slug="dice-average-roll",name="Dice Average Roll",cat="Fun",icon="🎲",desc="Average total of rolling a number of dice each with given sides.",fields=[["sides","Sides","","e.g. 6"],["n","Dice count","","e.g. 3"]],rows=[["Average total","n*(sides+1)/2",""]],note="Mean per die = (sides+1)/2.")
T(slug="dice-success-probability",name="Dice Success Probability",cat="Fun",icon="🎲",desc="Probability of rolling at or above a target on a die.",fields=[["sides","Sides","","e.g. 20"],["target","Target","","e.g. 15"]],rows=[["Probability","(sides-target+1)/sides*100","%"]],note="P = (sides−target+1)/sides.")
T(slug="dice-expected-successes",name="Dice Expected Successes",cat="Fun",icon="🎲",desc="Expected number of successes when rolling dice needing a target or higher.",fields=[["sides","Sides","","e.g. 6"],["n","Dice count","","e.g. 10"],["target","Target","","e.g. 5"]],rows=[["Expected successes","n*(sides-target+1)/sides",""]],note="E = n · (sides−target+1)/sides.")
T(slug="rpg-carrying-capacity",name="RPG Carrying Capacity",cat="Fun",icon="🎲",desc="Light-load carrying capacity in pounds from a strength score (×15 rule).",fields=[["str","Strength","","e.g. 12"]],rows=[["Capacity","str*15","lb"]],note="Common ×15 strength rule.")
T(slug="rpg-loot-split",name="RPG Loot Split",cat="Fun",icon="🎲",desc="Per-adventurer share of loot from total coins and party size.",fields=[["total","Total coins","","e.g. 1200"],["party","Party size","","e.g. 4"]],rows=[["Share each","total/party","coins"]],note="Equal split.")

# === Cycling ===
T(slug="cycling-gear-inches",name="Cycling Gear Inches",cat="Productivity",icon="🚴",desc="Gear inches from chainring, cog, and wheel diameter.",fields=[["chain","Chainring teeth","","e.g. 50"],["cog","Cog teeth","","e.g. 15"],["wd","Wheel diameter","in","e.g. 26.5"]],rows=[["Gear inches","chain/cog*wd","in"]],note="Gear inches = chainring/cog · wheel dia.")
T(slug="cycling-rollout",name="Cycling Rollout",cat="Productivity",icon="🚴",desc="Distance per pedal revolution (rollout) from gear ratio and wheel diameter.",fields=[["chain","Chainring teeth","","e.g. 50"],["cog","Cog teeth","","e.g. 15"],["wd","Wheel diameter","in","e.g. 26.5"]],rows=[["Rollout","chain/cog*wd*Math.PI","in"]],note="Rollout = gear inches · π.")
T(slug="cycling-gradient",name="Cycling Gradient",cat="Productivity",icon="🚴",desc="Road gradient percentage from vertical ascent and horizontal distance.",fields=[["rise","Ascent","m","e.g. 100"],["run","Distance","m","e.g. 2000"]],rows=[["Gradient","rise/run*100","%"]],note="Gradient = rise/run · 100.")
T(slug="cycling-speed-from-cadence",name="Cycling Speed from Cadence",cat="Productivity",icon="🚴",desc="Speed from gear ratio, wheel circumference, and cadence.",fields=[["gr","Gear ratio","","e.g. 3.33"],["circ","Wheel circumference","m","e.g. 2.1"],["cad","Cadence","rpm","e.g. 90"]],rows=[["Speed","gr*circ*cad*60/1000","km/h"]],note="Speed = ratio · circ · cadence · 60 / 1000.")
T(slug="cycling-climbing-power",name="Cycling Climbing Power",cat="Productivity",icon="🚴",desc="Power to climb at a gradient from mass, grade, and speed.",fields=[["m","Mass","kg","e.g. 75"],["grade","Grade","","e.g. 0.08"],["v","Speed","km/h","e.g. 15"]],rows=[["Power","m*9.81*v/3.6*grade","W"]],note="P = mg·v·grade (climbing only).")

# === Photography ===
T(slug="hyperfocal-distance",name="Hyperfocal Distance",cat="Image",icon="🖼️",desc="Hyperfocal distance from focal length, aperture, and circle of confusion.",fields=[["f","Focal length","mm","e.g. 35"],["N","Aperture (f-number)","","e.g. 8"],["coc","Circle of confusion","mm","e.g. 0.03"]],rows=[["Hyperfocal distance","f*f/(N*coc)+f","mm"]],note="H = f²/(N·c) + f.")
T(slug="print-resolution-dpi",name="Print Resolution (DPI)",cat="Image",icon="🖼️",desc="Print resolution in DPI from image pixels and the printed size.",fields=[["px","Pixels","","e.g. 3000"],["inches","Print size","in","e.g. 10"]],rows=[["DPI","px/inches","dpi"]],note="DPI = pixels / inches.")
T(slug="flash-guide-number",name="Flash Guide Number",cat="Image",icon="🖼️",desc="Flash guide number from aperture and the distance for correct exposure.",fields=[["N","Aperture","","e.g. 4"],["d","Distance","m","e.g. 10"]],rows=[["Guide number","N*d","m"]],note="GN = aperture · distance.")
T(slug="nd-filter-shutter",name="ND Filter Shutter",cat="Image",icon="🖼️",desc="Adjusted shutter speed from base shutter and ND filter stops.",fields=[["base","Base shutter","s","e.g. 0.001"],["stops","Stops","","e.g. 6"]],rows=[["New shutter","base*Math.pow(2,stops)","s"]],note="Shutter = base · 2^stops.")
T(slug="field-of-view",name="Field of View",cat="Image",icon="🖼️",desc="Field of view in degrees from sensor dimension and focal length.",fields=[["sensor","Sensor size","mm","e.g. 36"],["f","Focal length","mm","e.g. 50"]],rows=[["FOV","2*Math.atan(sensor/(2*f))*180/Math.PI","deg"]],note="FOV = 2·atan(sensor/(2f)).")
T(slug="crop-factor",name="Camera Crop Factor",cat="Image",icon="🖼️",desc="Crop factor relative to full frame from the sensor diagonal.",fields=[["diag","Sensor diagonal","mm","e.g. 28"]],rows=[["Crop factor","43.27/diag",""]],note="Full-frame diagonal ≈ 43.27 mm.")
T(slug="star-trail-500-rule",name="Star Trail 500 Rule",cat="Image",icon="🖼️",desc="Max shutter for pin-point stars from focal length using the 500 rule.",fields=[["f","Focal length","mm","e.g. 24"]],rows=[["Max shutter","500/f","s"]],note="500 rule: shutter ≤ 500 / focal length.")
T(slug="macro-magnification",name="Macro Magnification",cat="Image",icon="🖼️",desc="Magnification from extension tube length and lens focal length.",fields=[["ext","Extension tube","mm","e.g. 50"],["f","Focal length","mm","e.g. 50"]],rows=[["Magnification","ext/f",""]],note="M = extension / focal length.")

# === Acoustics ===
T(slug="spl-combine-two-sources",name="Combine Two Sound Levels",cat="Audio",icon="🎵",desc="Total sound level in dB from combining two independent sources.",fields=[["L1","Level 1","dB","e.g. 80"],["L2","Level 2","dB","e.g. 80"]],rows=[["Combined level","10*Math.log(Math.pow(10,L1/10)+Math.pow(10,L2/10))/Math.log(10)","dB"]],note="L = 10 log(10^(L1/10)+10^(L2/10)).")
T(slug="midi-note-frequency",name="MIDI Note Frequency",cat="Audio",icon="🎵",desc="Frequency of a musical note from its MIDI note number (A4 = 69 = 440 Hz).",fields=[["n","MIDI note","","e.g. 69"]],rows=[["Frequency","440*Math.pow(2,(n-69)/12)","Hz"]],note="f = 440 · 2^((n−69)/12).")
T(slug="cents-between-frequencies",name="Cents Between Frequencies",cat="Audio",icon="🎵",desc="Interval in cents between two frequencies.",fields=[["f","Frequency","Hz","e.g. 442"],["f0","Reference","Hz","e.g. 440"]],rows=[["Cents","1200*Math.log(f/f0)/Math.log(2)","cents"]],note="cents = 1200 · log2(f/f0).")
T(slug="sound-distance-time",name="Sound Travel Time",cat="Audio",icon="🎵",desc="Time for sound to cross a distance in air at 343 m/s.",fields=[["d","Distance","m","e.g. 100"]],rows=[["Time","d/343*1000","ms"]],note="t = d / 343 m/s.")
T(slug="wavelength-from-delay-ms",name="Wavelength from Delay",cat="Audio",icon="🎵",desc="Acoustic wavelength from a delay in milliseconds (speed 343 m/s).",fields=[["ms","Delay","ms","e.g. 10"]],rows=[["Wavelength","343*ms/1000","m"]],note="λ = 343 · delay(s).")

# === Astronomy ===
T(slug="star-distance-modulus",name="Star Distance (Distance Modulus)",cat="Math",icon="🔭",desc="Distance in parsecs from apparent and absolute magnitude.",fields=[["m","Apparent mag","","e.g. 0"],["M","Absolute mag","","e.g. 5"]],rows=[["Distance","Math.pow(10,((m-M+5)/5))","pc"]],note="m − M = 5 log(d) − 5.")
T(slug="hohmann-transfer-period",name="Hohmann Transfer Period",cat="Math",icon="🔭",desc="Half-period of a Hohmann transfer around the Sun between two orbital radii.",fields=[["r1","Inner radius","AU","e.g. 1"],["r2","Outer radius","AU","e.g. 1.524"]],rows=[["Transfer time","Math.PI*Math.sqrt(Math.pow((r1+r2)/2,3))","years"]],note="Uses Kepler's 3rd law (AU, years, solar mass).")
T(slug="planet-orbital-period-kepler",name="Planet Orbital Period (Kepler)",cat="Math",icon="🔭",desc="Orbital period in years from semi-major axis in AU around a Sun-mass star.",fields=[["a","Semi-major axis","AU","e.g. 1.524"]],rows=[["Period","Math.sqrt(a*a*a)","years"]],note="T = √(a³) in AU/years (solar mass).")
T(slug="redshift-velocity",name="Redshift Velocity (Relativistic)",cat="Math",icon="🔭",desc="Recession velocity from redshift z using the relativistic Doppler formula.",fields=[["z","Redshift","","e.g. 0.1"]],rows=[["Velocity","3e8*((Math.pow(1+z,2)-1)/(Math.pow(1+z,2)+1))","m/s"]],note="v = c·((1+z)²−1)/((1+z)²+1).")
T(slug="telescope-magnification",name="Telescope Magnification",cat="Math",icon="🔭",desc="Magnification of a telescope from its focal length and the eyepiece focal length.",fields=[["ft","Telescope focal","mm","e.g. 1000"],["fe","Eyepiece focal","mm","e.g. 20"]],rows=[["Magnification","ft/fe","x"]],note="M = f_telescope / f_eyepiece.")
T(slug="telescope-light-gathering",name="Telescope Light Gathering",cat="Math",icon="🔭",desc="Light-gathering power relative to a 7 mm dark-adapted eye pupil.",fields=[["ap","Aperture","mm","e.g. 100"]],rows=[["Gathering power","Math.pow(ap/7,2)","x"]],note="Relative to 7 mm eye pupil.")

# === Earth / Environment ===
T(slug="rainfall-volume",name="Rainfall Volume",cat="Environment",icon="🌍",desc="Water volume collected from a catchment area and rainfall depth (1 mm over 1 m² = 1 L).",fields=[["area","Area","m²","e.g. 100"],["rain","Rainfall","mm","e.g. 15"]],rows=[["Volume","area*rain","L"]],note="1 mm/m² = 1 L.")
T(slug="snow-water-equivalent",name="Snow Water Equivalent",cat="Environment",icon="🌍",desc="Water depth from snow depth and the snow's water-density fraction.",fields=[["snow","Snow depth","mm","e.g. 300"],["frac","Water fraction","","e.g. 0.1"]],rows=[["Water depth","snow*frac","mm"]],note="Water = snow depth · density fraction.")
T(slug="earthquake-energy",name="Earthquake Energy",cat="Environment",icon="🌍",desc="Energy released from moment magnitude using the Gutenberg formula.",fields=[["M","Magnitude","","e.g. 5"]],rows=[["Energy","Math.pow(10,1.5*M+4.8)","joules"]],note="log10(E) = 1.5M + 4.8.")
T(slug="wind-power-density",name="Wind Power Density",cat="Environment",icon="🌍",desc="Power available per unit area from air density and wind speed.",fields=[["rho","Air density","kg/m³","e.g. 1.225"],["v","Wind speed","m/s","e.g. 10"]],rows=[["Power density","0.5*rho*v*v*v","W/m²"]],note="P/A = ½ρv³.")
T(slug="heating-degree-day",name="Heating Degree Day",cat="Environment",icon="🌍",desc="Daily heating degree-days from a base temperature and the outdoor temperature.",fields=[["base","Base temp","°C","e.g. 18"],["out","Outdoor temp","°C","e.g. 5"]],rows=[["Degree-days","Math.max(base-out,0)","°C·day"]],note="HDD = max(base − outdoor, 0).")

# === Electronics ===
T(slug="capacitor-energy-stored",name="Capacitor Energy Stored",cat="Math",icon="⚡",desc="Energy stored in a charged capacitor from capacitance and voltage.",fields=[["C","Capacitance","F","e.g. 0.001"],["V","Voltage","V","e.g. 12"]],rows=[["Energy","0.5*C*V*V","J"],["Charge","C*V","C"]],note="U = ½CV²; Q = CV.")
T(slug="inductor-energy-stored",name="Inductor Energy Stored",cat="Math",icon="⚡",desc="Energy stored in an inductor from inductance and current.",fields=[["L","Inductance","H","e.g. 0.01"],["I","Current","A","e.g. 2"]],rows=[["Energy","0.5*L*I*I","J"]],note="U = ½LI².")
T(slug="rl-time-constant",name="RL Time Constant",cat="Math",icon="⚡",desc="Time constant of a resistor-inductor circuit from inductance and resistance.",fields=[["L","Inductance","H","e.g. 0.1"],["R","Resistance","Ω","e.g. 50"]],rows=[["Time constant","L/R","s"]],note="τ = L/R.")
T(slug="current-divider-two-resistors",name="Current Divider (Two Resistors)",cat="Math",icon="⚡",desc="Current through the second resistor when total current splits across two parallel resistors.",fields=[["I","Total current","A","e.g. 1"],["r1","Resistor 1","Ω","e.g. 100"],["r2","Resistor 2","Ω","e.g. 50"]],rows=[["Current in r2","I*r1/(r1+r2)","A"]],note="I2 = I · r1/(r1+r2).")
T(slug="wire-resistance",name="Wire Resistance",cat="Math",icon="⚡",desc="Resistance of a wire from resistivity, length, and cross-sectional area.",fields=[["rho","Resistivity","Ω·m","e.g. 1.68e-8"],["L","Length","m","e.g. 10"],["A","Area","m²","e.g. 1e-6"]],rows=[["Resistance","rho*L/A","Ω"]],note="R = ρL/A.")
T(slug="decibel-voltage-ratio",name="Decibel Voltage Ratio",cat="Math",icon="⚡",desc="Decibel level difference between two voltages across equal impedances.",fields=[["V1","Voltage 1","V","e.g. 10"],["V2","Voltage 2","V","e.g. 1"]],rows=[["Level difference","20*Math.log(V1/V2)/Math.log(10)","dB"]],note="L = 20 log10(V1/V2).")
T(slug="led-power-dissipation",name="LED Power Dissipation",cat="Math",icon="⚡",desc="Power dissipated by an LED from its forward voltage and current.",fields=[["Vf","Forward voltage","V","e.g. 3.2"],["I","Current","A","e.g. 0.02"]],rows=[["Power","Vf*I","W"]],note="P = Vf · I.")
T(slug="parallel-two-resistors",name="Parallel Two Resistors",cat="Math",icon="⚡",desc="Equivalent resistance of two resistors in parallel.",fields=[["r1","Resistor 1","Ω","e.g. 100"],["r2","Resistor 2","Ω","e.g. 100"]],rows=[["Equivalent","r1*r2/(r1+r2)","Ω"]],note="R = r1·r2/(r1+r2).")

# === Number theory / math ===
T(slug="digit-sum",name="Digit Sum",cat="Math",icon="📐",desc="Sum of the decimal digits of an integer.",fields=[["n","Number","","e.g. 12345"]],rows=[["Digit sum","String(Math.abs(Math.round(n))).split('').reduce(function(s,d){return s+(+d);},0)",""]],note="Adds each decimal digit.")
T(slug="digital-root",name="Digital Root",cat="Math",icon="📐",desc="Repeated digit sum (digital root) of a positive integer.",fields=[["n","Number","","e.g. 9876"]],rows=[["Digital root","n>0?1+(Math.round(n)-1)%9:0",""]],note="dr(n) = 1 + (n−1) mod 9.")
T(slug="factorial",name="Factorial",cat="Math",icon="📐",desc="Factorial n! of a non-negative integer.",fields=[["n","Number","","e.g. 6"]],rows=[["Factorial","Array.from({length:Math.round(n)},function(_,i){return i+1;}).reduce(function(a,b){return a*b;},1)",""]],note="n! = 1·2·…·n.")
T(slug="fibonacci-nth",name="Nth Fibonacci Number",cat="Math",icon="📐",desc="The nth Fibonacci number (F(0)=0, F(1)=1).",fields=[["n","Index","","e.g. 10"]],rows=[["F(n)","Array.from({length:Math.round(n)}).reduce(function(p){return [p[1],p[0]+p[1]];},[0,1])[0]",""]],note="Iterative reduction.")
T(slug="triangular-number",name="Triangular Number",cat="Math",icon="📐",desc="The nth triangular number T(n).",fields=[["n","n","","e.g. 7"]],rows=[["Triangular number","n*(n+1)/2",""]],note="T(n) = n(n+1)/2.")
T(slug="sum-of-squares",name="Sum of Squares 1..n",cat="Math",icon="📐",desc="Sum of the squares of the integers from 1 to n.",fields=[["n","n","","e.g. 5"]],rows=[["Sum of squares","n*(n+1)*(2*n+1)/6",""]],note="n(n+1)(2n+1)/6.")
T(slug="sum-of-cubes",name="Sum of Cubes 1..n",cat="Math",icon="📐",desc="Sum of the cubes of the integers from 1 to n.",fields=[["n","n","","e.g. 4"]],rows=[["Sum of cubes","Math.pow(n*(n+1)/2,2)",""]],note="= [n(n+1)/2]².")
T(slug="combinations-count",name="Combinations (n choose k)",cat="Math",icon="📐",desc="Number of k-element combinations of n items.",fields=[["n","n","","e.g. 10"],["k","k","","e.g. 3"]],rows=[["Combinations","Array.from({length:Math.round(n)},function(_,i){return i+1;}).reduce(function(a,b){return a*b;},1)/(Array.from({length:Math.round(k)},function(_,i){return i+1;}).reduce(function(a,b){return a*b;},1)*Array.from({length:Math.round(n-k)},function(_,i){return i+1;}).reduce(function(a,b){return a*b;},1))",""]],note="C(n,k) = n!/(k!(n−k)!).")
T(slug="permutations-count",name="Permutations (n pick k)",cat="Math",icon="📐",desc="Number of ordered k-permutations of n items.",fields=[["n","n","","e.g. 10"],["k","k","","e.g. 3"]],rows=[["Permutations","Array.from({length:Math.round(n)},function(_,i){return i+1;}).reduce(function(a,b){return a*b;},1)/Array.from({length:Math.round(n-k)},function(_,i){return i+1;}).reduce(function(a,b){return a*b;},1)",""]],note="P(n,k) = n!/(n−k)!.")
T(slug="number-of-digits",name="Number of Digits",cat="Math",icon="📐",desc="Count of decimal digits in an integer (absolute value).",fields=[["n","Number","","e.g. 12345"]],rows=[["Digits","String(Math.abs(Math.round(n))).length",""]],note="Length of the decimal representation.")
T(slug="reverse-integer",name="Reverse Integer",cat="Math",icon="📐",desc="Decimal digits of an integer reversed, preserving sign.",fields=[["n","Number","","e.g. 12345"]],rows=[["Reversed","parseInt(String(Math.abs(Math.round(n))).split('').reverse().join(''),10)*(n<0?-1:1)",""]],note="Reverses the decimal digit order.")

# ---- rendering -----------------------------------------------------------
def esc(s): return str(s).replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
def escq(s): return json.dumps(str(s))  # safe JS/HTML-attribute double-quoted string

STYLE = """.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px;margin:10px 0}
label.f{font-size:13px;opacity:.85;display:block;margin-bottom:4px}
.field{background:var(--bg,#14181f);border:1px solid var(--border,#2a2f3a);border-radius:8px;padding:10px}
.field:focus-within{border-color:var(--accent,#6ea8fe);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#6ea8fe) 18%,transparent)}
.field input{box-sizing:border-box;width:100%;background:transparent;color:var(--text,#e6e6e6);border:none;font-size:18px;font-family:ui-monospace,monospace;padding:2px 0;outline:none}
.field .unit{font-size:12px;color:var(--text-dim,#9aa3b2);margin-top:6px}
.out{background:var(--bg-elev,#171a21);border:1px solid var(--border,#2a2f3a);border-radius:10px;padding:16px;margin:12px 0}
.out .big{font-size:2rem;font-weight:800;font-family:ui-monospace,monospace;text-align:center;padding:4px 0 8px}
.out .row{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--border,#2a2f3a);font-size:14px}
.out .row:last-child{border-bottom:none}
.out .row .k{color:var(--text-dim,#9aa3b2)}
.out .row .v{font-family:ui-monospace,monospace;font-weight:700;color:var(--accent,#6ea8fe)}
.note{color:var(--text-dim,#9aa3b2);font-size:13px;margin:10px 0}"""

def render_html(e):
    fields = e["fields"]; rows = e["rows"]; ids = [f[0] for f in fields]
    fhtml = []
    for fid, label, unit, ph in fields:
        h = f'<div class="field"><label class="f" for="in-{fid}">{esc(label)}</label>'
        h += f'<input type="text" id="in-{fid}" inputmode="decimal" autocomplete="off" placeholder="{esc(ph)}">'
        if unit: h += f'<div class="unit">{esc(unit)}</div>'
        h += '</div>'
        fhtml.append(h)
    decls = "".join(f"var {i}E=document.getElementById('in-{i}');" for i in ids)
    parses = "".join(f"var {i}=parseFloat({i}E.value);" for i in ids)
    guard_list = ",".join(ids)
    rowcalcs = "".join(f"var r{k}={row[1]};" for k, row in enumerate(rows))
    big_unit = rows[0][2]
    big_js = f"var html='<div class=\"big\">'+fmt(r0)+{escq((' '+big_unit) if big_unit else '')}+'</div>';"
    renders = ""
    for k in range(1, len(rows)):
        lab, expr, unit = rows[k]
        renders += f"html+=row({escq(lab)},fmt(r{k})+{escq((' '+unit) if unit else '')});"
    hooks = f"[{','.join(i+'E' for i in ids)}].forEach(function(el){{el.addEventListener('input',calc)}});"
    note = e.get("note", "")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="/assets/theme-init.js"></script>
<title>{esc(e['name'])} — Virtual Tools</title>
<link rel="stylesheet" href="/assets/style.css">
<style>
{STYLE}
</style>
</head>
<body>
<div id="site-header"></div>
<main>
<div class="tool-header">
<a class="back" href="/">&#8592; All tools</a>
<h1>{esc(e['name'])}</h1>
<p>{esc(e['desc'])}</p>
</div>
<div class="panel">
<div class="grid2">
{chr(10).join(fhtml)}
</div>
<div class="out" id="out" aria-live="polite" aria-atomic="true"><span style="color:var(--text-dim,#9aa3b2)">Enter values to calculate.</span></div>
<p class="note">{esc(note)}</p>
</div>
</main>
<script src="/assets/app.js"></script>
<script>
(function(){{
function fmt(x){{if(typeof x==='boolean')return x?'Yes':'No';if(!isFinite(x))return '—';var r=Math.round(x*1e6)/1e6;return ''+r;}}
function row(k,v){{return '<div class="row"><span class="k">'+k+'</span><span class="v">'+v+'</span></div>';}}
{decls}var out=document.getElementById('out');
function calc(){{
{parses}
if([{guard_list}].some(function(v){{return isNaN(v);}})){{out.innerHTML='<span style="color:var(--text-dim,#9aa3b2)">Enter values to calculate.</span>';return;}}
{rowcalcs}
{big_js}
{renders}
out.innerHTML=html;
}}
{hooks}
calc();
}})();
</script>
</body>
</html>
"""

def registry_entry(e):
    return (
        "  {\n"
        f"    slug: {json.dumps(e['slug'])},\n"
        f"    name: {json.dumps(e['name'])},\n"
        f"    description: {json.dumps(e['desc'])},\n"
        f"    category: {json.dumps(e['cat'])},\n"
        f"    icon: {json.dumps(e['icon'])},\n"
        f"    added: {json.dumps(e.get('added','2026-08-17T00:00:00Z'))},\n"
        "  },\n"
    )

# ---- main ---------------------------------------------------------------
def main():
    # load existing slugs + names (folders + registry + redirect policy)
    existing_slugs = set()
    for p in TOOLS_DIR.iterdir():
        if p.is_dir(): existing_slugs.add(p.name)
    reg = TOOLS_JS.read_text(encoding="utf-8")
    existing_slugs |= set(re.findall(r'slug: "([^"]+)"', reg))
    existing_names = set(re.findall(r'name: "([^"]+)"', reg))
    current = len(re.findall(r'slug: "', reg))
    need = TARGET_TOTAL - current
    print(f"current registered: {current}; need {need} more to reach {TARGET_TOTAL}")
    if need <= 0:
        print("already at/above target"); return

    seen_slug = set(); seen_name = set(); written = []; skipped = []
    for e in TABLE:
        if len(written) >= need: break
        sl, nm = e["slug"], e["name"]
        if sl in existing_slugs or sl in seen_slug:
            skipped.append((sl, "slug collision")); continue
        if nm in existing_names or nm in seen_name:
            skipped.append((sl, "name collision")); continue
        seen_slug.add(sl); seen_name.add(nm); written.append(e)
    if len(written) < need:
        print(f"only {len(written)} clean candidates, need {need}"); sys.exit(1)

    # write tool pages
    for e in written:
        d = TOOLS_DIR / e["slug"]; d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(render_html(e), encoding="utf-8")
    # append registry entries before the closing "];"
    text = TOOLS_JS.read_text(encoding="utf-8")
    m = re.search(r"\n\];\s*$", text)
    assert m, "no ]; close found in tools.js"
    insert = "\n" + "".join(registry_entry(e) for e in written)
    text = text[:m.start()] + insert + text[m.start():]
    TOOLS_JS.write_text(text, encoding="utf-8")
    print(f"written {len(written)} tools ({len(skipped)} skipped)")
    for sl, why in skipped[:20]: print(f"  skip {sl}: {why}")
    for e in written[:3]: print(f"  + /tools/{e['slug']}/  ({e['name']})")

if __name__ == "__main__":
    main()