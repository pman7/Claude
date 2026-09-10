# Verification record – partial program "Ops 6–18" of the 74-op lower-bar job

Source program: 1,040,380 lines, CRLF, 74 operations, 12 tool changes (T05, T06, T15, T10,
T11, T15, T07, T09, T12, T07, T14, T06).  Partial program: 40,438 lines, ops 6–18, all T06.

## Layout of the partial (all regions confirmed with `cmp`)

| partial lines | content                                                   | source lines        |
|---------------|-----------------------------------------------------------|---------------------|
| 1–3           | `G53 Z0.` / `G53 X0. Y0.` / `G53 A0. B0.`                 | 1–3                 |
| 4–7           | `T06` / `S20000` / `M3 ` / `G53 Z0.0` (program-start form, T/S substituted) | template: 4–7 |
| 8–9           | `G55` / `G90 A180 B0.0`                                   | 406201–406202       |
| 10–11         | `M8` / `G4 X2.0` (from T06's first op)                    | 286658–286659       |
| 12–40431      | op 6 `F1500` … op 18 `G0 Z62.635`, verbatim               | 406203–446622       |
| 40432–40438   | `M5 ` / `G53 Z0.` / `G53 B0` / `G53 X0. Y0.` / `G53 A0. B0.` / `M9 ` / `M30` | 1040374–1040380 |

* lines 1–17 byte-identical to the first 17 lines of both hyperDENT-native partial
  exports (same T06 / S20000 / F1500 / A180 start); last 7 lines identical to theirs
* `cut SOURCE 7 7` is byte-identical to hyperDENT's own `semi_finish_plan.nc` through the
  end of op 7 (its first 1,694 lines)
* `cut SOURCE 1 74` reproduces the source byte-for-byte

## Independent reviewers (each instructed to refute, each returned "not refuted", high confidence)

1. **Splice integrity** – rebuilt the expected file from raw source bytes without the
   script: identical (md5 `ef78367d…`); no BOM / NUL / bare LF / non-ASCII; 13 G55 blocks
   match source ops 6–18 on G90, F, G43 H6, tilt and first move; the slice contains no
   S / M / D words and only G0 G1 G43 G53 G55 G90, and the whole source uses only
   G0 G1 G4 G43 G53 G55 G90, so no modal state set before op 6 is missing.
2. **Controller modal state** – own Fanuc-style tracer over the full source and the
   partial: motion group, G90, G55, G43+H, F, S, T, M3, M8 and commanded X Y Z A B
   (machine vs work frame) identical at op 6's G43 line, at its first positioning move,
   at every op boundary through op 18, and at M30 (only the inert F modal differs after
   M30).
3. **Format fidelity** – byte-level comparison with the two hyperDENT-native exports:
   program-start block, all 12 op-boundary blocks and the program-end block identical in
   shape, including trailing spaces (`M3 `, `M5 `, `M9 `, `G0 Z80.0 G43 H6 `) and the
   absence of one on the program-start `S20000`.
4. **Crash hazards** – no sequence in the partial that the source does not execute
   identically at the same point: tool call at A0 B0 after Z-first retracts, rotation to
   A180 with Z at machine home, G43 activated at Z80, every op boundary retracts to
   G53 Z0 / B0 / X0 Y0 before the next rotation, F set before every G1, H matches T.
   Inherent precondition noted: op 6's first rapid goes to Z5.84, below raw stock, so the
   partial must run on a blank already machined through op 5.
5. **Script review** – 295 op ranges (74 single, 74 prefix, 74 suffix, 73 pairs) built
   by the script equal an independently written expectation; 30 mutants of the partial
   (deleted / swapped / duplicated lines, changed digits, wrong T or H, missing M8, wrong
   range, LF endings, missing final EOL, footer edits …) all rejected by `verify`.
   Findings on other files in the family (not this one) were fixed afterwards: a
   program-end block with an unexpected line is now refused instead of being swallowed
   into the last op; a mid-tool spindle-speed change is honoured; `verify` never aborts
   with a traceback; `cut` writes to a temp file and renames only after `verify` passes;
   the approach-sequence literals and trailing-dot numbers are parsed numerically; the
   first-positioning-move check uses offsets, not text search.
6. **Op matching** – independent re-derivation with SHA-1 fingerprints confirms:
   `semi_finish_plan.nc` = source op 7 (exact, = partial op 2) + source op 74 (exact);
   `just_flat.nc` = near-copy of op 13 (16 of 1,190 lines differ, max 0.117 mm), exact
   ops 20, 22, 25, 26, 29, 30, 36, 42, 54, near-copies of ops 48 and 68, and one T14 F500
   op with no counterpart in the source.  Ops 6, 8–12 and 14–18 appear in neither file.
