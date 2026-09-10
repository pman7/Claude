# nc_partial – cut a safe partial program out of a hyperDENT / ARUM 5-axis NC file

`nc_partial.py` splits a hyperDENT-posted NC program (the `Denis_Titanium_Bar…` family:
no comments, no N-numbers, CRLF, `G53` retracts between operations) into its operations
and writes a **self-contained partial program** for any range of them.

Everything in the partial file is copied byte-for-byte from the source, except the T and
S words of the program-start block, which are substituted from the tool change that the
first selected op uses.  The output was checked byte-for-byte against partial programs
that hyperDENT itself exported (`just_flat.nc`, `semi_finish_plan.nc`): the program-start
block, the op boundaries and the program-end block are identical in format.

## Usage

```bash
# 1. list the operations (same order / numbering as the simulation "Move List")
python3 nc_partial.py list  SOURCE.nc

# 2. cut ops 6..18 into a new program (runs the verifier afterwards)
python3 nc_partial.py cut   SOURCE.nc 6 18 SOURCE_Op06-Op18.nc

# 3. re-verify an existing partial against its source
python3 nc_partial.py verify SOURCE.nc 6 18 SOURCE_Op06-Op18.nc

# 4. find out which SOURCE ops another NC file contains (byte-identical bodies)
python3 nc_partial.py match  SOURCE.nc OTHER.nc
```

## What a partial program looks like

```
G53 Z0.              <- original program start (machine home Z, then XY, then A/B)
G53 X0. Y0.
G53 A0. B0.
T06                  <- tool of the first selected op   (substituted)
S20000               <- its spindle speed                (substituted)
M3
G53 Z0.0
G55                  <- first selected op, verbatim from here on ...
G90 A180 B0.0
M8                   <- coolant + dwell: borrowed from the first op of that tool
G4 X2.0                 (only if the selected op is not itself the first op of the tool)
F1500
G0 Z80.0 G43 H6      <- tool length comp at safe height, then the fixed approach
G0 X0.0
G0 Y-68.0
G0 A180.0 B0.000
G0 X0.0 Y0.0
G0 A180.0 B0.0
G0 X-31.955 Y-3.189  <- first real positioning move of the op
...                  <- ops 6..18 verbatim, including their G53 retracts / tool changes
G0 Z62.635
M5                   <- original program end
G53 Z0.
G53 B0
G53 X0. Y0.
G53 A0. B0.
M9
M30
```

## Checks performed by `verify`

* line endings identical to the source (CRLF) and file ends with a terminator
* output is byte-identical to a fresh build from the same source and range
* the body – from the first op's `F` word to the last op's final retract – is a verbatim
  contiguous slice of the source
* the footer is the source's own program-end block
* header contains exactly one `T`, plus `S`, `M3`, `M8`, `G4`, `G55`, `G90 A.. B..` in the
  order hyperDENT emits them, and the tool activation block equals the source's own
  program-start block with only T/S substituted
* X, Y and Z are at machine home when `G43` is activated
* the full modal / positional state (motion group, work offset, G90, G43 H, F, S, T,
  spindle, coolant, X Y Z A B, which axes are homed) is **identical** in the source and
  the partial right after the `G43` line and again at the op's first positioning move
* every line parses into known words only; the op count is right
* `cut SOURCE 1 74` reproduces the source byte-for-byte (round trip)

## Op numbering vs the simulation

The simulation shows larger block numbers than the file's line numbers (it counts blocks
its own way, e.g. 410 930 vs line 406 201 for Op. 6), but the **op order and count are the
same**: op *n* in `list` is "Op. n" in the simulation's Move List.  Cross-check with the
tilt angles and the tool number, which `list` prints per op (e.g. Op. 18 = T06,
`A179.249 B-4.016`; Op. 19 = T15, the first D1.50 op).
