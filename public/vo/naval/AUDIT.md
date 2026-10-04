# Naval voice processing audit

All 43 supplied WAV sources were converted to mono 48 kHz MP3 at 96 kbps, trimmed at -45 dB while preserving 30 ms edge pads, and normalized to -16 LUFS / -1.5 dBTP.

## Results

- Silent after trimming: none.
- The following sources contain audio through the final 30 ms and may have been cut at source: `bear_cap_aa`, `bear_cap_commence`, `dc_fire_frame40`, `fc_bearing`, `fc_cruiser_range`, `fc_d1`, `fc_d7`, `fc_flagship_range`, `fc_million`, `fc_point`, `mc1_brace`, `sonar_diving`, `spot_straddle`.
- These files are not shortened at the ending. Their complete source audio is retained, followed by a 30 ms output pad.
- No semantically safe replacement exists for digit clips `fc_d1` and `fc_d7`; substituting another digit would make market readouts false. The complete supplied recordings are retained.
- Closest legacy variants remain available to the general radio system, but are not substituted into number readouts or fleet-specific lines because doing so would change the spoken event.

The source URLs are the user-supplied project assets from October 4, 2026.