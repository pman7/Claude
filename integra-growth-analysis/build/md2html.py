"""Convert report.md into a self-contained HTML artifact page (no external libraries).
Handles: h1-h4, paragraphs, bold/italic/code/links, bullet and numbered lists, pipe tables, hr.
Usage: python3 md2html.py ../report.md out.html"""
import re, sys, html

def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'<em>\1</em>', t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\[([^\]]+)\]\((https?://[^)\s]+)\)', r'<a href="\2" target="_blank" rel="noopener">\1</a>', t)
    return t

def slug(t):
    s = re.sub(r'[^a-z0-9]+', '-', t.lower()).strip('-')
    return s[:60]

def convert(md):
    lines = md.split('\n'); i = 0; out = []; toc = []
    while i < len(lines):
        ln = lines[i]
        if not ln.strip():
            i += 1; continue
        m = re.match(r'^(#{1,4})\s+(.*)$', ln)
        if m:
            lvl = len(m.group(1)); txt = m.group(2).strip()
            sid = slug(txt)
            if lvl == 2: toc.append((sid, txt))
            out.append(f'<h{lvl} id="{sid}">{inline(txt)}</h{lvl}>')
            i += 1; continue
        if re.match(r'^-{3,}\s*$', ln):
            out.append('<hr>'); i += 1; continue
        if ln.lstrip().startswith('|'):
            rows = []
            while i < len(lines) and lines[i].lstrip().startswith('|'):
                rows.append(lines[i]); i += 1
            cells = [[c.strip() for c in r.strip().strip('|').split('|')] for r in rows]
            if len(cells) >= 2 and all(re.match(r'^:?-{2,}:?$', c) for c in cells[1]):
                head = cells[0]; body = cells[2:]
            else:
                head = None; body = cells
            t = ['<div class="tablewrap"><table>']
            if head:
                t.append('<thead><tr>' + ''.join(f'<th>{inline(c)}</th>' for c in head) + '</tr></thead>')
            t.append('<tbody>')
            for r in body:
                t.append('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>')
            t.append('</tbody></table></div>')
            out.append('\n'.join(t)); continue
        if re.match(r'^\s*[-*]\s+', ln):
            items = []
            while i < len(lines) and re.match(r'^\s*[-*]\s+', lines[i]):
                item = re.sub(r'^\s*[-*]\s+', '', lines[i]); i += 1
                while i < len(lines) and lines[i].strip() and not re.match(r'^\s*[-*]\s+', lines[i]) and not lines[i].startswith('#') and not lines[i].lstrip().startswith('|') and not re.match(r'^\s*\d+\.\s+', lines[i]):
                    item += ' ' + lines[i].strip(); i += 1
                items.append(f'<li>{inline(item)}</li>')
            out.append('<ul>' + ''.join(items) + '</ul>'); continue
        if re.match(r'^\s*\d+\.\s+', ln):
            items = []
            while i < len(lines) and re.match(r'^\s*\d+\.\s+', lines[i]):
                item = re.sub(r'^\s*\d+\.\s+', '', lines[i]); i += 1
                while i < len(lines) and lines[i].strip() and not re.match(r'^\s*\d+\.\s+', lines[i]) and not lines[i].startswith('#') and not lines[i].lstrip().startswith('|') and not re.match(r'^\s*[-*]\s+', lines[i]):
                    item += ' ' + lines[i].strip(); i += 1
                items.append(f'<li>{inline(item)}</li>')
            out.append('<ol>' + ''.join(items) + '</ol>'); continue
        # paragraph
        para = [ln.strip()]; i += 1
        while i < len(lines) and lines[i].strip() and not lines[i].startswith('#') and not lines[i].lstrip().startswith('|') and not re.match(r'^\s*([-*]|\d+\.)\s+', lines[i]) and not re.match(r'^-{3,}\s*$', lines[i]):
            para.append(lines[i].strip()); i += 1
        out.append(f'<p>{inline(" ".join(para))}</p>')
    return '\n'.join(out), toc

TEMPLATE = """<title>Integra Growth Options</title>
<meta name="description" content="Where Integra Dental Design should grow, what each option costs all-in, and a 90-day plan with gates.">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
:root{
  --bg:#F7F5EF; --panel:#FFFFFF; --ink:#1B1A17; --ink-2:#4A4842; --ink-3:#6E6B63;
  --line:#DDD9CF; --line-soft:#ECE8DF; --accent:#1F5F6B; --accent-soft:#E3EEF0; --warn:#8A5A1E; --warn-soft:#F5EBDD; --ok:#3F6B4A;
  --serif:"Source Serif 4",Georgia,"Times New Roman",serif; --sans:"Inter",-apple-system,"Segoe UI",Helvetica,Arial,sans-serif; --mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;
  --measure:70ch;
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --bg:#141412; --panel:#1C1B18; --ink:#EDE9E0; --ink-2:#C6C1B5; --ink-3:#948F84;
  --line:#33312C; --line-soft:#26251F; --accent:#7FC2CC; --accent-soft:#1B2E31; --warn:#E0B06A; --warn-soft:#2A2117; --ok:#8FC79A; color-scheme:dark; } }
:root[data-theme="dark"]{
  --bg:#141412; --panel:#1C1B18; --ink:#EDE9E0; --ink-2:#C6C1B5; --ink-3:#948F84;
  --line:#33312C; --line-soft:#26251F; --accent:#7FC2CC; --accent-soft:#1B2E31; --warn:#E0B06A; --warn-soft:#2A2117; --ok:#8FC79A; color-scheme:dark; }
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--serif);font-size:1.0625rem;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:62rem;margin:0 auto;padding-block:2rem 4rem;padding-inline:clamp(16px,4vw,2.5rem)}
.masthead{border-bottom:1px solid var(--line);padding-bottom:1.25rem;margin-bottom:1.5rem}
.kicker{font-family:var(--sans);font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-weight:600;margin:0 0 .5rem}
h1{font-size:clamp(1.75rem,1.2rem+2.4vw,2.6rem);line-height:1.15;margin:0 0 .6rem;letter-spacing:-.015em;text-wrap:balance;font-weight:600}
h2{font-size:clamp(1.35rem,1.1rem+1.1vw,1.8rem);line-height:1.2;margin:2.6rem 0 .8rem;letter-spacing:-.01em;text-wrap:balance;font-weight:600;padding-top:1.2rem;border-top:1px solid var(--line-soft)}
h3{font-size:1.2rem;line-height:1.3;margin:1.8rem 0 .5rem;font-weight:600;text-wrap:balance}
h4{font-family:var(--sans);font-size:.95rem;margin:1.4rem 0 .4rem;font-weight:600}
p{margin:0 0 .95rem;max-width:var(--measure);color:var(--ink)}
p strong{color:var(--ink)}
ul,ol{margin:0 0 1rem;padding-left:1.4rem;max-width:var(--measure)}
li{margin:.3rem 0}
a{color:var(--accent);text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--accent) 45%,transparent);text-underline-offset:2px}
a:hover{text-decoration-color:var(--accent)}
code{font-family:var(--mono);font-size:.85em;background:var(--accent-soft);padding:.05em .35em;border-radius:4px}
hr{border:0;border-top:1px solid var(--line-soft);margin:2rem 0}
.tablewrap{overflow-x:auto;margin:1rem 0 1.4rem;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
table{border-collapse:collapse;width:100%;font-family:var(--sans);font-size:.84rem;line-height:1.4;font-variant-numeric:tabular-nums}
th,td{padding:.55rem .7rem;border-bottom:1px solid var(--line-soft);vertical-align:top;text-align:left;min-width:7rem}
th{background:var(--accent-soft);color:var(--ink);font-weight:600;position:sticky;top:0}
tr:last-child td{border-bottom:0}
td:first-child,th:first-child{min-width:11rem}
.toc{font-family:var(--sans);font-size:.9rem;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:1rem 1.2rem;margin:1.5rem 0 2rem;columns:2;column-gap:2rem}
.toc ol{margin:0;padding-left:0;max-width:none;list-style:none}
.toc li{margin:.2rem 0;break-inside:avoid}
.meta{font-family:var(--sans);font-size:.85rem;color:var(--ink-3);margin:0}
.note{font-family:var(--sans);font-size:.85rem;color:var(--ink-2);background:var(--warn-soft);border-left:3px solid var(--warn);padding:.7rem 1rem;border-radius:0 6px 6px 0;margin:1rem 0 1.5rem;max-width:var(--measure)}
@media (max-width:640px){ .toc{columns:1} body{font-size:1rem} }
</style>
<div class="wrap">
<header class="masthead">
<p class="kicker">Growth options analysis</p>
%%H1%%
<p class="meta">%%META%%</p>
</header>
<nav class="toc" aria-label="Contents"><ol>%%TOC%%</ol></nav>
<p class="note">Figures labeled estimate are the analyst's; facts carry a dated source link. The model files behind every number (inputs.json, model.py, outputs.md, ranking.md) and the outreach drafts are in the repository folder <code>integra-growth-analysis</code>.</p>
%%BODY%%
</div>
"""

def build(md_path, out_path):
    md = open(md_path, encoding='utf-8').read()
    # pull h1 and the two meta lines
    lines = md.split('\n')
    h1 = next((l for l in lines if l.startswith('# ')), '# Integra Growth Options')
    h1_txt = h1[2:].strip()
    meta_lines = []
    for l in lines[1:8]:
        if l.strip() and not l.startswith('#') and not l.startswith('How to read'):
            meta_lines.append(l.strip())
        if l.startswith('How to read'): break
    md_body = md.replace(h1, '', 1)
    for ml in meta_lines: md_body = md_body.replace(ml, '', 1)
    body, toc = convert(md_body)
    toc_html = ''.join(f'<li><a href="#{sid}">{html.escape(txt)}</a></li>' for sid, txt in toc)
    page = TEMPLATE.replace('%%H1%%', f'<h1>{inline(h1_txt)}</h1>').replace('%%META%%', inline(' · '.join(meta_lines))).replace('%%TOC%%', toc_html).replace('%%BODY%%', body)
    open(out_path, 'w', encoding='utf-8').write(page)
    print('wrote', out_path, len(page), 'bytes;', len(toc), 'sections')

if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2])
