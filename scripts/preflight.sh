#!/bin/sh
# Run every documented source and unit check in one pass.
#
# This is the local equivalent of the CI gate: the repository ships no GitHub
# workflows, so this script is what a pre-push hook or release run should call.
set -eu
cd "$(dirname "$0")/.."

python3 scripts/apply_tool_curation.py
python3 scripts/generate_tool_catalog.py frontend --check
python3 scripts/generate_formula_workbenches.py --check
python3 scripts/validate_formula_workbenches.py .
python3 scripts/validate_tools.py frontend
python3 scripts/validate_generated_conversions.py .
python3 scripts/validate_tool_design.py frontend
python3 scripts/validate_risk_policy.py .
python3 scripts/validate_browser_security.py
python3 scripts/validate_operations.py
node scripts/validate_javascript.mjs frontend
node scripts/validate_formula_workbenches.mjs .
node tests/security/math-expression.test.cjs
node tests/unit_converter.test.cjs
node tests/chess_clock.test.cjs
node tests/interval_ear_trainer.test.cjs
node tests/skyscraper_puzzle.test.cjs
node tests/bingo_card_generator.test.cjs
node tests/printable_paper_generator.test.cjs
node tests/packing_list_generator.test.cjs
node tests/audio_sync_drift_calculator.test.cjs
node tests/fishing_line_capacity_calculator.test.cjs
node tests/uncompressed_video_data_rate_calculator.test.cjs
node tests/rectangular_waveguide_calculator.test.cjs
node tests/golf_course_handicap_calculator.test.cjs
node tests/render_time_estimator.test.cjs
node tests/practice_tempo_ramp_planner.test.cjs
node tests/radio_horizon_calculator.test.cjs
node tests/hiking_time_calculator.test.cjs
node tests/frame_rate_conform_calculator.test.cjs
node tests/transposing_instrument_calculator.test.cjs
node tests/receiver_sensitivity_calculator.test.cjs
node tests/fish_weight_calculator.test.cjs
node tests/shutter_angle_calculator.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'

echo "preflight: all checks passed"
