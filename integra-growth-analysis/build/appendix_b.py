"""Build Appendix B from research/*.json (agent findings). Prints markdown."""
import json, glob, os, sys, re
ORDER = ['puget_market','puget_costs','soc_market','soc_costs','maui_market','alaska_market','dfw_miami_markets',
         'logistics','regulatory','competition_national','tri_fda','equipment_market','lab_to_lab','switching']
TITLES = {'puget_market':'Puget Sound market','puget_costs':'Puget Sound costs and taxes','soc_market':'South Orange County market',
          'soc_costs':'South Orange County costs and California compliance','maui_market':'Maui and Hawaii market',
          'alaska_market':'Alaska market','dfw_miami_markets':'Dallas-Fort Worth and Miami markets',
          'regulatory':'Regulatory, tax and entity compliance by state, FDA, CDL and HIPAA'}
d = sys.argv[1]
DIGEST = len(sys.argv) > 2 and sys.argv[2] == '--digest'
files = {os.path.basename(f)[:-5]: f for f in glob.glob(os.path.join(d, '*.json'))}
keys = [k for k in ORDER if k in files] + sorted(k for k in files if k not in ORDER)
out = ['## Appendix B. Research-agent findings by cluster', '',
       'Fourteen clusters were commissioned and all fourteen returned structured findings before this report was finalized; the adversarial critique is included as its own section. Each agent was instructed to read primary pages through the fetch service, label every claim fact / historical / estimate / unknown, and record the source URL and date. The author re-verified the consequential claims against the primary pages (Appendix A) before using them in the body; where an agent figure was not re-verified it is reported here as the agent stated it. Confidence is the agent\'s own.', '']
if DIGEST:
    out += ['The full structured findings (every claim with its label, confidence, value, source URL and date; named targets with decision-makers; competitor maps; cost items; unknowns) run to more than 25,000 words and are in the companion file `research/appendix-b-agent-findings.md`, generated from the agents\' JSON output in `research/`. This appendix carries each agent\'s own summary so the report stands alone.', '']
for k in keys:
    r = json.load(open(files[k]))
    out.append(f"### B.{keys.index(k)+1} {TITLES.get(k, k.replace('_',' ').title())}")
    out.append('')
    out.append(f"*Scope:* {r.get('topic','')}")
    out.append('')
    summ = r.get('summary','').strip()
    out.append("**Agent summary.** " + re.sub(r'\s*\n+\s*', ' ', summ))
    out.append('')
    if DIGEST: continue
    f = r.get('findings') or []
    if f:
        out.append('**Findings.**'); out.append('')
        for it in f:
            kind = it.get('kind','?'); conf = it.get('confidence','?')
            val = it.get('value'); val = f" Value: {val}." if val and str(val).lower() not in ('n/a','none','') else ''
            url = it.get('source_url',''); date = it.get('source_date','')
            src = f" [source]({url})" if url and url.startswith('http') else ''
            dt = f" ({date})" if date else ''
            out.append(f"- *{kind}, {conf} confidence.* {it.get('claim','').strip()}.{val}{src}{dt}")
        out.append('')
    t = r.get('targets') or []
    if t:
        out.append('**Targets named.**'); out.append('')
        for it in t:
            url = it.get('source_url',''); src = f" [source]({url})" if url and url.startswith('http') else ''
            out.append(f"- **{it.get('name','')}** ({it.get('type','')}; {it.get('location','')}). {it.get('why','')} Decision-maker: {it.get('decision_maker','')}. Reach: {it.get('how_to_reach','')}.{src}")
        out.append('')
    c = r.get('competitors') or []
    if c:
        out.append('**Competitors mapped.**'); out.append('')
        for it in c:
            url = it.get('source_url',''); src = f" [source]({url})" if url and url.startswith('http') else ''
            out.append(f"- **{it.get('name','')}** ({it.get('location','')}): {it.get('what','')} Pricing: {it.get('pricing','')} Turnaround: {it.get('turnaround','')} {it.get('notes','')}{src}")
        out.append('')
    ci = r.get('cost_items') or []
    if ci:
        out.append('**Cost items (low / base / high, USD).**'); out.append('')
        out.append('| Item | Low | Base | High | Period | Status | Source |'); out.append('|---|---|---|---|---|---|---|')
        for it in ci:
            url = it.get('source_url',''); src = f"[link]({url})" if url and url.startswith('http') else ''
            def m(x):
                try: return f"{float(x):,.0f}" if float(x)>=10 else f"{float(x):,.2f}"
                except: return str(x)
            out.append(f"| {it.get('item','')} | {m(it.get('low_usd'))} | {m(it.get('base_usd'))} | {m(it.get('high_usd'))} | {it.get('period','')} | {it.get('status','')} | {src} |")
        out.append('')
    u = r.get('unknowns') or []
    if u:
        out.append('**Unknowns the agent could not resolve.**'); out.append('')
        for it in u:
            out.append(f"- {str(it).strip()}")
        out.append('')
print('\n'.join(out))
