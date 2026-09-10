#!/usr/bin/env python3
"""
nc_partial.py - cut a safe, self-contained partial program out of a hyperDENT / ARUM
style 5-axis NC file (the "Denis_Titanium_Bar" family of programs).

The source programs have NO comments and NO N-numbers.  Operations are delimited purely
by structure:

    <end of previous op body>
    G53 Z0.            \
    G53 B0              |  retract-to-home prefix (mid-tool op boundary)
    G53 X0. Y0.        /
    G55                <- every op restarts here (work offset)
    G90 A180 B0.0      <- absolute rotary pre-position
    F1500              <- feed (every op restates it)
    G0 Z80.0 G43 H6    <- tool length comp at safe height
    G0 X0.0
    G0 Y-68.0
    G0 A180.0 B0.000
    G0 X0.0 Y0.0
    G0 A180.0 B0.0
    G0 X.. Y..         <- first real positioning move
    ...

A tool change replaces the 3-line retract prefix with:

    M9
    M5
    G53 Z0
    G53 B0
    G53 X0 Y0
    G53 A0.0 B0.0
    T06
    S20000
    M3
    G53 Z0.0
    G53 X0.0 Y0.0
    G55
    G90 A180 B0.0
    M8                 <- only present in the first op of a tool
    G4 X2.0            <- only present in the first op of a tool
    F1000
    G0 Z80.0 G43 H6
    ...

The program starts with `G53 Z0. / G53 X0. Y0. / G53 A0. B0.` and ends with
`M5 / G53 Z0. / G53 B0 / G53 X0. Y0. / G53 A0. B0. / M9 / M30`.

Extracting ops [a..b] therefore produces:

    <original program start (G53 retracts before the first T word)>
    <tool activation for the tool that op a uses: T.. S.. M3 G53 Z0.0 G53 X0.0 Y0.0>
    <op a header: G55, G90 A.. B..>
    <M8 / G4 X2.0 borrowed from the first op of that tool, if op a does not have them>
    <op a from its F line onwards, verbatim>
    <ops a+1 .. b verbatim, including their retract prefixes / tool changes>
    <original program end: M5 ... M30>

Every op body is copied byte-for-byte (CRLF preserved, trailing spaces preserved).

Usage:
    nc_partial.py list  SOURCE.nc
    nc_partial.py cut   SOURCE.nc FIRST_OP LAST_OP OUTPUT.nc
    nc_partial.py verify SOURCE.nc FIRST_OP LAST_OP OUTPUT.nc
    nc_partial.py match  SOURCE.nc OTHER.nc      # which SOURCE ops does OTHER contain?

Op numbers are 1-based and count `G55` blocks in file order, which is the same order the
hyperDENT simulation "Move List" shows them (Op. 1, Op. 2, ...).
"""
import re
import sys
from dataclasses import dataclass, field
from typing import List, Optional

CRLF = b"\r\n"
WORD_RE = re.compile(rb"([A-Z])([-+]?\d*\.?\d*)")

RETRACT_RE = re.compile(rb"^G53\b")
TOOL_RE = re.compile(rb"^T(\d+)\s*$")
SPEED_RE = re.compile(rb"^S(\d+)\s*$")
M_RE = re.compile(rb"^M(\d+)\s*$")
OP_START_RE = re.compile(rb"^G55\s*$")
G90_RE = re.compile(rb"^G90\s+A([-+]?\d*\.?\d+)\s+B([-+]?\d*\.?\d+)\s*$")
FEED_RE = re.compile(rb"^F(\d*\.?\d+)\s*$")
G43_RE = re.compile(rb"^G0\s+Z([-+]?\d*\.?\d+)\s+G43\s+H(\d+)\s*$")
COOLANT_RE = re.compile(rb"^M8\s*$")
DWELL_RE = re.compile(rb"^G4\s+X[\d.]+\s*$")

# Lines that may make up the prefix between two op bodies (retract + tool change).
PREFIX_LINE_RES = [RETRACT_RE, TOOL_RE, SPEED_RE, re.compile(rb"^M[359]\s*$")]


def is_prefix_line(line: bytes) -> bool:
    return any(r.match(line) for r in PREFIX_LINE_RES)


@dataclass
class Op:
    index: int                     # 1-based
    prefix_start: int              # first line of retract / tool-change prefix (0-based)
    header_start: int              # the G55 line (0-based)
    body_end: int                  # last line of the op body (inclusive, 0-based)
    tool: Optional[int] = None
    speed: Optional[int] = None
    feed: Optional[bytes] = None
    h: Optional[int] = None
    g90_ab: Optional[tuple] = None
    has_coolant: bool = False
    has_dwell: bool = False
    first_pos_line: Optional[int] = None
    first_pos: Optional[bytes] = None
    ab_words: List[bytes] = field(default_factory=list)

    @property
    def n_lines(self) -> int:
        return self.body_end - self.header_start + 1


@dataclass
class Program:
    lines: List[bytes]
    eol: bytes
    ops: List[Op]
    start_lines: List[bytes]       # program start before the first T word (G53 retracts)
    footer_start: int              # 0-based index of the first footer line (M5 ... M30)


def read_lines(path: str):
    data = open(path, "rb").read()
    if b"\r\n" in data:
        eol = b"\r\n"
    else:
        eol = b"\n"
    if data.endswith(eol):
        data = data[: -len(eol)]
        trailing = True
    else:
        trailing = False
    lines = data.split(eol)
    for i, ln in enumerate(lines):
        if b"\r" in ln or b"\n" in ln:
            raise SystemExit(f"line {i+1}: mixed line endings, refusing to continue")
    return lines, eol, trailing


def parse(path: str) -> Program:
    lines, eol, trailing = read_lines(path)
    if not trailing:
        raise SystemExit("source file does not end with a line terminator; refusing to continue")

    op_starts = [i for i, ln in enumerate(lines) if OP_START_RE.match(ln)]
    if not op_starts:
        raise SystemExit("no G55 op-start blocks found")

    # footer: walk back from EOF over prefix-type lines (M30, M9, G53..., M5)
    footer_start = len(lines)
    while footer_start > 0 and (is_prefix_line(lines[footer_start - 1]) or re.match(rb"^M30\s*$", lines[footer_start - 1])):
        footer_start -= 1
    if not re.match(rb"^M30\s*$", lines[-1]):
        raise SystemExit("last line is not M30; refusing to continue")

    ops: List[Op] = []
    current_tool = None
    current_speed = None
    for k, hs in enumerate(op_starts):
        # prefix: walk back over retract / tool-change lines
        ps = hs
        while ps > 0 and is_prefix_line(lines[ps - 1]):
            ps -= 1
        body_end = (op_starts[k + 1] if k + 1 < len(op_starts) else footer_start) - 1
        # strip the *next* op's prefix from this op's body
        while body_end > hs and is_prefix_line(lines[body_end]):
            body_end -= 1
        # tool / speed in this op's prefix
        for i in range(ps, hs):
            m = TOOL_RE.match(lines[i])
            if m:
                current_tool = int(m.group(1))
            m = SPEED_RE.match(lines[i])
            if m:
                current_speed = int(m.group(1))
        op = Op(index=k + 1, prefix_start=ps, header_start=hs, body_end=body_end,
                tool=current_tool, speed=current_speed)
        # header words
        j = hs + 1
        m = G90_RE.match(lines[j]) if j <= body_end else None
        if not m:
            raise SystemExit(f"op {op.index}: line {j+1} expected 'G90 A.. B..', got {lines[j]!r}")
        op.g90_ab = (m.group(1).decode(), m.group(2).decode())
        j += 1
        if COOLANT_RE.match(lines[j]):
            op.has_coolant = True
            j += 1
        if DWELL_RE.match(lines[j]):
            op.has_dwell = True
            j += 1
        m = FEED_RE.match(lines[j])
        if not m:
            raise SystemExit(f"op {op.index}: line {j+1} expected 'F..', got {lines[j]!r}")
        op.feed = m.group(1)
        j += 1
        m = G43_RE.match(lines[j])
        if not m:
            raise SystemExit(f"op {op.index}: line {j+1} expected 'G0 Z.. G43 H..', got {lines[j]!r}")
        op.h = int(m.group(2))
        if op.tool is None or op.h != op.tool:
            raise SystemExit(f"op {op.index}: H{op.h} does not match active tool T{op.tool}")
        # first positioning move: first G0 with X and Y after the fixed approach sequence
        # (G0 X0.0 / G0 Y-68.0 / G0 A.. B.. / G0 X0.0 Y0.0 / G0 A.. B..)
        j += 1
        # fixed safe-approach sequence: G0 X0.0 / G0 Y-68.0 / G0 A.. B.. / G0 X0.0 Y0.0 [/ G0 A.. B..]
        expected = [rb"^G0 X0\.0\s*$", rb"^G0 Y-68\.0\s*$", rb"^G0 A[-\d.]+ B[-\d.]+\s*$",
                    rb"^G0 X0\.0 Y0\.0\s*$"]
        for pat in expected:
            if not re.match(pat, lines[j]):
                raise SystemExit(f"op {op.index}: line {j+1} expected {pat!r}, got {lines[j]!r}")
            j += 1
        if re.match(rb"^G0 A[-\d.]+ B[-\d.]+\s*$", lines[j]):
            j += 1
        op.first_pos_line = j
        op.first_pos = lines[j]
        if not lines[j].startswith(b"G0 "):
            raise SystemExit(f"op {op.index}: line {j+1} expected a G0 positioning move, got {lines[j]!r}")
        # all distinct A/B words in the op (for the report)
        seen = []
        for i in range(hs, body_end + 1):
            ln = lines[i]
            if b"A" in ln or b"B" in ln:
                ab = b" ".join(w for w in ln.split() if w[:1] in (b"A", b"B"))
                if ab and ab not in seen:
                    seen.append(ab)
        op.ab_words = seen
        ops.append(op)

    # program start = everything before the first op's T word
    first = ops[0]
    t_line = next(i for i in range(first.prefix_start, first.header_start) if TOOL_RE.match(lines[i]))
    if first.prefix_start != 0:
        raise SystemExit("unexpected lines before the first retract block")
    start_lines = lines[0:t_line]
    return Program(lines=lines, eol=eol, ops=ops, start_lines=start_lines, footer_start=footer_start)


def first_op_of_tool(prog: Program, op: Op) -> Op:
    """The op whose prefix carries the most recent tool change at or before `op`."""
    for cand in reversed(prog.ops[: op.index]):
        if any(TOOL_RE.match(prog.lines[i]) for i in range(cand.prefix_start, cand.header_start)):
            return cand
    raise SystemExit(f"op {op.index}: no tool change found before it")


def tool_activation_lines(prog: Program, op: Op) -> List[bytes]:
    """The program-start tool activation block for the tool that `op` uses.

    hyperDENT emits a *different* block at program start than at a mid-program tool
    change (verified against partial programs exported by hyperDENT itself):

        program start (op 1):          mid-program tool change:
            T05                            T06
            S18000                         S20000<space>
            M3<space>                      M3<space>
            G53 Z0.0                       G53 Z0.0
            G55                            G53 X0.0 Y0.0
                                           G55

    So the block is taken from the original program's own start (lines between the
    first T word and the first G55) as a template, with the T and S words replaced by
    the ones from the tool change that precedes `op`.  Every other byte is verbatim."""
    lines = prog.lines
    first = prog.ops[0]
    t0 = next(i for i in range(first.prefix_start, first.header_start) if TOOL_RE.match(lines[i]))
    template = lines[t0: first.header_start]
    cand = first_op_of_tool(prog, op)
    t_line = next(lines[i] for i in range(cand.prefix_start, cand.header_start) if TOOL_RE.match(lines[i]))
    s_line = next(lines[i] for i in range(cand.prefix_start, cand.header_start) if SPEED_RE.match(lines[i]))
    out = []
    for ln in template:
        if TOOL_RE.match(ln):
            out.append(b"T" + TOOL_RE.match(t_line).group(1) + ln[len(b"T") + len(TOOL_RE.match(ln).group(1)):])
        elif SPEED_RE.match(ln):
            out.append(b"S" + SPEED_RE.match(s_line).group(1) + ln[len(b"S") + len(SPEED_RE.match(ln).group(1)):])
        else:
            out.append(ln)
    return out, cand


def coolant_lines(prog: Program, first_op_of_tool: Op) -> List[bytes]:
    lines = prog.lines
    out = []
    j = first_op_of_tool.header_start + 2  # after G55 and G90
    while COOLANT_RE.match(lines[j]) or DWELL_RE.match(lines[j]):
        out.append(lines[j])
        j += 1
    return out


def build_partial(prog: Program, a: int, b: int) -> List[bytes]:
    if not (1 <= a <= b <= len(prog.ops)):
        raise SystemExit(f"op range {a}..{b} out of 1..{len(prog.ops)}")
    lines = prog.lines
    opa, opb = prog.ops[a - 1], prog.ops[b - 1]
    out: List[bytes] = []
    out += prog.start_lines                                   # G53 Z0. / G53 X0. Y0. / G53 A0. B0.
    act, first_of_tool = tool_activation_lines(prog, opa)     # T.. S.. M3 G53 Z0.0 G53 X0.0 Y0.0
    out += act
    j = opa.header_start
    out.append(lines[j]); j += 1                              # G55
    out.append(lines[j]); j += 1                              # G90 A.. B..
    if opa.has_coolant or opa.has_dwell:
        # op a is itself the first op of the tool: its own M8 / G4 follow
        pass
    else:
        out += coolant_lines(prog, first_of_tool)             # M8 / G4 X2.0
    out += lines[j: opb.body_end + 1]                         # verbatim through the end of op b
    out += lines[prog.footer_start:]                          # M5 ... M30
    return out


def write_lines(path: str, out_lines: List[bytes], eol: bytes):
    with open(path, "wb") as f:
        f.write(eol.join(out_lines) + eol)


def describe(prog: Program, op: Op) -> str:
    return (f"Op.{op.index:>3}  T{op.tool:02d} S{op.speed} F{op.feed.decode():<5} H{op.h:<2} "
            f"G90 A{op.g90_ab[0]} B{op.g90_ab[1]:<7} lines {op.header_start+1:>8}-{op.body_end+1:<8} "
            f"({op.n_lines:>6} ln)  first pos: {op.first_pos.decode().strip():<26} "
            f"A/B seen: {', '.join(w.decode() for w in op.ab_words)}")


def cmd_list(src: str):
    prog = parse(src)
    eolname = 'CRLF' if prog.eol == CRLF else 'LF'
    print(f"{src}: {len(prog.lines)} lines, {len(prog.ops)} ops, eol={eolname}")
    print("program start :", " | ".join(l.decode().strip() for l in prog.start_lines))
    print("program footer:", " | ".join(l.decode().strip() for l in prog.lines[prog.footer_start:]))
    for op in prog.ops:
        tc = " (tool change)" if any(TOOL_RE.match(prog.lines[i]) for i in range(op.prefix_start, op.header_start)) else ""
        print(describe(prog, op) + tc)


def cmd_cut(src: str, a: int, b: int, dst: str):
    prog = parse(src)
    out = build_partial(prog, a, b)
    write_lines(dst, out, prog.eol)
    print(f"wrote {dst}: {len(out)} lines, ops {a}..{b}")
    cmd_verify(src, a, b, dst, prog=prog)


# ---------------------------------------------------------------- verification

def _num(val: bytes):
    try:
        return float(val)
    except ValueError:
        return val.decode()


def modal_state(lines: List[bytes], upto: int) -> dict:
    """Track every modal word through lines[0:upto] (exclusive).  Numeric values are
    compared as numbers, so `G53 Z0.` and `G53 Z0.0` are the same state."""
    st = {"G_motion": None, "G_offset": None, "G_dist": None, "G_comp": None, "H": None,
          "F": None, "S": None, "T": None, "spindle": None, "coolant": None,
          "X": None, "Y": None, "Z": None, "A": None, "B": None,
          "homed": frozenset()}   # axes sitting at machine home (G53 ..0) since their last programmed move
    for ln in lines[:upto]:
        words = WORD_RE.findall(ln)
        g53 = False
        for letter, val in words:
            if not val and letter not in (b"M",):
                continue
            if letter == b"G":
                g = val
                if g in (b"0", b"1", b"2", b"3"):
                    st["G_motion"] = g
                elif g in (b"54", b"55", b"56", b"57", b"58", b"59"):
                    st["G_offset"] = g
                elif g in (b"90", b"91"):
                    st["G_dist"] = g
                elif g in (b"43", b"49"):
                    st["G_comp"] = g
                elif g == b"53":
                    g53 = True
                elif g == b"4":
                    pass
                else:
                    st.setdefault("G_other", set()).add(g)
            elif letter == b"M":
                if val == b"3":
                    st["spindle"] = "M3"
                elif val == b"5":
                    st["spindle"] = "M5"
                elif val == b"8":
                    st["coolant"] = "M8"
                elif val == b"9":
                    st["coolant"] = "M9"
                elif val == b"30":
                    st["spindle"] = "M5"; st["coolant"] = "M9"
            elif letter in (b"F", b"S", b"T", b"H"):
                st[letter.decode()] = _num(val)
            elif letter in (b"X", b"Y", b"Z", b"A", b"B"):
                ax = letter.decode()
                if g53:
                    st[ax] = ("G53", _num(val))
                    st["homed"] = st["homed"] | {ax} if _num(val) == 0.0 else st["homed"] - {ax}
                else:
                    if ln.startswith(b"G4 "):  # dwell X is a time, not a position
                        continue
                    st[ax] = _num(val)
                    st["homed"] = st["homed"] - {ax}
    return st


def cmd_verify(src: str, a: int, b: int, dst: str, prog: Program = None):
    prog = prog or parse(src)
    out_lines, eol, trailing = read_lines(dst)
    ok = True

    def check(cond, msg):
        nonlocal ok
        print(("  PASS " if cond else "  FAIL ") + msg)
        ok = ok and bool(cond)

    print(f"verifying {dst} against {src} ops {a}..{b}")
    eolname = 'CRLF' if eol == CRLF else 'LF'
    check(eol == prog.eol and trailing, f"line endings match source ({eolname}) and file ends with EOL")
    expected = build_partial(prog, a, b)
    check(out_lines == expected, "output is byte-identical to a fresh build")

    opa, opb = prog.ops[a - 1], prog.ops[b - 1]
    # verbatim body: from op a's F line through op b's end
    body_src = prog.lines[opa.header_start + 2 + (2 if (opa.has_coolant and opa.has_dwell) else 0): opb.body_end + 1]
    # locate the F line of op a in the output
    f_idx = next(i for i, ln in enumerate(out_lines) if FEED_RE.match(ln))
    body_out = out_lines[f_idx: f_idx + len(body_src)]
    check(body_out == body_src, f"body (from op {a} F-word to end of op {b}) is a verbatim slice: {len(body_src)} lines")
    check(out_lines[f_idx + len(body_src):] == prog.lines[prog.footer_start:], "footer is the original program footer (M5 ... M30)")
    check(out_lines[-1].startswith(b"M30"), "last line is M30")

    # header structure
    hdr = out_lines[:f_idx]
    print("  header:")
    for ln in hdr:
        print("     | " + ln.decode())
    check(hdr[: len(prog.start_lines)] == prog.start_lines, "starts with the original program-start retracts")
    check(sum(1 for l in hdr if TOOL_RE.match(l)) == 1, "exactly one T word in the header")
    check(any(SPEED_RE.match(l) for l in hdr), "S word present")
    check(any(re.match(rb"^M3\s*$", l) for l in hdr), "M3 present")
    check(any(COOLANT_RE.match(l) for l in hdr), "M8 present")
    check(any(DWELL_RE.match(l) for l in hdr), "G4 dwell present")
    check(any(OP_START_RE.match(l) for l in hdr), "G55 present")
    check(any(G90_RE.match(l) for l in hdr), "G90 A.. B.. present")
    t_hdr = next(int(TOOL_RE.match(l).group(1)) for l in hdr if TOOL_RE.match(l))
    check(t_hdr == opa.tool, f"header tool T{t_hdr:02d} == op {a} tool T{opa.tool:02d}")
    # order: T, S, M3, G53 Z (after T), G55, G90, M8, G4 -- strictly increasing line index
    t_i = next(i for i, l in enumerate(hdr) if TOOL_RE.match(l))
    order = [t_i] + [next(i for i, l in enumerate(hdr) if i > t_i and r.match(l)) for r in
                     (SPEED_RE, re.compile(rb"^M3\s*$"), re.compile(rb"^G53 Z"), OP_START_RE, G90_RE, COOLANT_RE, DWELL_RE)]
    check(order == sorted(order) and len(set(order)) == len(order), "header order: T, S, M3, G53 Z, G55, G90, M8, G4")
    # the activation block must be the original program-start block with only T/S substituted
    first = prog.ops[0]
    t0 = next(i for i in range(first.prefix_start, first.header_start) if TOOL_RE.match(prog.lines[i]))
    template = prog.lines[t0: first.header_start]
    g55_i = next(i for i, l in enumerate(hdr) if OP_START_RE.match(l))
    act = hdr[t_i: g55_i]
    same_shape = len(act) == len(template) and all(
        (TOOL_RE.match(a) and TOOL_RE.match(b)) or (SPEED_RE.match(a) and SPEED_RE.match(b)) or a == b
        for a, b in zip(act, template))
    check(same_shape, "tool activation block == original program-start block with T/S substituted")

    # modal / positional state must be identical in both programs at (1) the G43 activation
    # line (first Z move after the tool is active) and (2) op a's first positioning move
    def compare(label, src_upto, out_upto):
        st_src = modal_state(prog.lines, src_upto)
        st_out = modal_state(out_lines, out_upto)
        same = st_src == st_out
        check(same, f"machine state identical at {label}")
        if not same:
            for k in sorted(set(st_src) | set(st_out)):
                if st_src.get(k) != st_out.get(k):
                    print(f"      {k}: source={st_src.get(k)} partial={st_out.get(k)}")
        print("     state:", {k: (sorted(v) if isinstance(v, frozenset) else v) for k, v in st_src.items()})
    g43_src = next(i for i in range(opa.header_start, opa.body_end + 1) if G43_RE.match(prog.lines[i]))
    g43_out = next(i for i, ln in enumerate(out_lines) if G43_RE.match(ln))
    check(modal_state(out_lines, g43_out)["homed"] >= {"X", "Y", "Z"}, "X, Y and Z are at machine home when G43 is activated")
    compare(f"the line right after op {a}'s 'G0 Z80.0 G43 H..' (tool active, length comp on)", g43_src + 1, g43_out + 1)
    out_first_pos = next(i for i, ln in enumerate(out_lines) if ln == opa.first_pos and i > f_idx)
    compare(f"op {a}'s first positioning move ({opa.first_pos.decode().strip()})", opa.first_pos_line, out_first_pos)

    # sanity: every output line parses into known words only
    bad = [i for i, ln in enumerate(out_lines) if not re.match(rb"^([GMTSFHXYZAB][-+]?(\d+\.?\d*|\.\d+)\s*)+$", ln)]
    check(not bad, f"every line is well-formed G-code words (bad lines: {[i+1 for i in bad[:5]]})")
    # sanity: the output contains exactly ops a..b
    out_ops = [i for i, ln in enumerate(out_lines) if OP_START_RE.match(ln)]
    check(len(out_ops) == b - a + 1, f"output contains {len(out_ops)} ops (expected {b - a + 1})")
    print("  ops in output:")
    for op in prog.ops[a - 1: b]:
        print("     " + describe(prog, op))
    print("RESULT:", "ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED")
    if not ok:
        sys.exit(1)


def main(argv):
    if len(argv) >= 3 and argv[1] == "list":
        cmd_list(argv[2])
    elif len(argv) == 6 and argv[1] == "cut":
        cmd_cut(argv[2], int(argv[3]), int(argv[4]), argv[5])
    elif len(argv) == 6 and argv[1] == "verify":
        cmd_verify(argv[2], int(argv[3]), int(argv[4]), argv[5])
    elif len(argv) == 4 and argv[1] == "match":
        cmd_match(argv[2], argv[3])
    else:
        print(__doc__)
        sys.exit(2)



# ---------------------------------------------------------------- op matching

def op_body_key(prog: Program, op: Op) -> List[bytes]:
    """The part of an op that is independent of its position in the program: from the
    'G0 Z80.0 G43 H..' line to the end of the body (feed/tool/tilt reported separately)."""
    j = op.header_start + 2
    while COOLANT_RE.match(prog.lines[j]) or DWELL_RE.match(prog.lines[j]):
        j += 1
    assert FEED_RE.match(prog.lines[j])
    return prog.lines[j + 1: op.body_end + 1]


def cmd_match(src: str, other: str):
    """For every op in OTHER, say which op of SRC it is (byte-identical body) or the
    closest candidate (same tool, same first positioning move) with a diff count."""
    import difflib
    prog = parse(src)
    oth = parse(other)
    src_keys = {}
    for op in prog.ops:
        src_keys.setdefault(bytes(b"\n".join(op_body_key(prog, op))), []).append(op)
    print(f"{other}: {len(oth.lines)} lines, {len(oth.ops)} ops")
    print(f"{src}: {len(prog.lines)} lines, {len(prog.ops)} ops")
    print()
    matched = []
    for op in oth.ops:
        key = bytes(b"\n".join(op_body_key(oth, op)))
        hits = src_keys.get(key, [])
        tc = "TC " if any(TOOL_RE.match(oth.lines[i]) for i in range(op.prefix_start, op.header_start)) else "   "
        head = (f"{tc}other Op.{op.index:>2}  T{op.tool:02d} S{op.speed} F{op.feed.decode():<5} "
                f"G90 A{op.g90_ab[0]} B{op.g90_ab[1]:<5} {op.n_lines:>6} ln  first pos {op.first_pos.decode().strip():<34}")
        if hits:
            same_fs = [h for h in hits if h.feed == op.feed and h.speed == op.speed and h.tool == op.tool and h.g90_ab == op.g90_ab]
            names = ", ".join(f"Op.{h.index}" for h in hits)
            flag = "EXACT" if same_fs else "BODY-EXACT but F/S/T/G90 differ"
            print(f"{head} => source {names}  [{flag}]")
            matched.append((op, hits[0], flag))
        else:
            cands = [h for h in prog.ops if h.tool == op.tool and h.first_pos == op.first_pos]
            if not cands:
                cands = [h for h in prog.ops if h.tool == op.tool and h.ab_words[-1:] == op.ab_words[-1:]]
            best = None
            for h in cands:
                a = op_body_key(prog, h); b = op_body_key(oth, op)
                sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
                ratio = sm.ratio()
                if best is None or ratio > best[1]:
                    best = (h, ratio, len(a), len(b))
            if best:
                h, ratio, la, lb = best
                print(f"{head} => closest source Op.{h.index} ({la} ln) similarity {ratio:.4f}  [DIFFERENT]")
            else:
                print(f"{head} => NO MATCH in source  [DIFFERENT]")
            matched.append((op, best[0] if best else None, "DIFFERENT"))
    print()
    print("summary:", ", ".join(f"Op.{m[1].index}" if m[1] else "?" for m in matched))
    return matched


if __name__ == "__main__":
    main(sys.argv)
