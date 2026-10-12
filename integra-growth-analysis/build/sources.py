"""Build Appendix A (sources) from the links in report.md, grouped by section, de-duplicated.
Usage: python3 sources.py ../report.md  -> prints markdown for the appendix."""
import re, sys
md = open(sys.argv[1], encoding='utf-8').read()
# cut any existing Appendix A to avoid self-reference
cut = md.find('\n## Appendix A')
if cut != -1: md = md[:cut]
section = 'Front matter'; seen = {}; order = []
for line in md.split('\n'):
    m = re.match(r'^##\s+(.*)$', line)
    if m: section = m.group(1).strip(); continue
    for txt, url in re.findall(r'\[([^\]]+)\]\((https?://[^)\s]+)\)', line):
        if url not in seen:
            seen[url] = (txt, section); order.append(url)
out = ['## Appendix A. Sources consulted (primary pages read October 12, 2026 unless the text says otherwise)', '',
       f'{len(order)} distinct sources are linked in the body. They are listed here once each, in the order they first appear, with the section that relies on them. Research-agent sources that are not linked in the body are in Appendix B.', '']
cur = None
for url in order:
    txt, sec = seen[url]
    if sec != cur:
        out.append(''); out.append(f'**{sec}**'); out.append(''); cur = sec
    out.append(f'- [{txt}]({url})')
print('\n'.join(out))
