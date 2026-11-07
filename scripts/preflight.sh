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
node tests/quilt_backing_calculator.test.cjs
node tests/vocal_range_calculator.test.cjs
node tests/intermodulation_products_calculator.test.cjs
node tests/track_lane_stagger_calculator.test.cjs
node tests/gop_length_calculator.test.cjs
node tests/weaving_warp_calculator.test.cjs
node tests/string_tension_calculator.test.cjs
node tests/erlang_b_trunking_calculator.test.cjs
node tests/baseball_slash_line_calculator.test.cjs
node tests/contact_sheet_planner.test.cjs
node tests/macrame_cord_calculator.test.cjs
node tests/song_form_duration_calculator.test.cjs
node tests/coaxial_cable_impedance_calculator.test.cjs
node tests/badminton_scorekeeper.test.cjs
node tests/video_ycbcr_converter.test.cjs
node tests/bead_loom_calculator.test.cjs
node tests/round_entry_planner.test.cjs
node tests/erlang_c_call_queue_calculator.test.cjs
node tests/tennis_scorekeeper.test.cjs
node tests/production_slate_generator.test.cjs
node tests/knitting_shaping_calculator.test.cjs
node tests/music_ornament_realizer.test.cjs
node tests/constellation_diagram_explorer.test.cjs
node tests/basketball_shot_chart.test.cjs
node tests/video_loop_planner.test.cjs
node tests/friendship_bracelet_pattern.test.cjs
node tests/sight_reading_exercise.test.cjs
node tests/line_coding_visualizer.test.cjs
node tests/pickleball_scorekeeper.test.cjs
node tests/telecine_pulldown_planner.test.cjs
node tests/quilt_block_layout_planner.test.cjs
node tests/rhythm_reading_exercise.test.cjs
node tests/ofdm_symbol_timing_calculator.test.cjs
node tests/cricket_net_run_rate_calculator.test.cjs
node tests/end_credits_roll_planner.test.cjs
node tests/utm_zone_calculator.test.cjs
node tests/systemd_service_builder.test.cjs
node tests/origami_crease_pattern_generator.test.cjs
node tests/chord_quality_ear_trainer.test.cjs
node tests/eye_diagram_explorer.test.cjs
node tests/golf_stableford_scorecard.test.cjs
node tests/video_transition_timeline_planner.test.cjs
node tests/map_tile_coordinate_calculator.test.cjs
node tests/process_scheduling_visualizer.test.cjs
node tests/string_art_pattern_generator.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'

echo "preflight: all checks passed"
