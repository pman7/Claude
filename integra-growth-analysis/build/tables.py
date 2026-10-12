"""Regenerate the report's model-driven tables from model.py and insert them between markers in report.md.
Markers: <!-- TABLE:name --> ... <!-- /TABLE:name -->. Run after model.py and ranking.py."""
import os, sys, re, json
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'model'))
from model import INP, unit_contribution, option_costs, demand_model, stress, feasibility, money, rng  # noqa
import ranking  # runs and exposes rows, PROFILES, total, quant_only

SHORT = {
 'bellevue_grow': 'A. Grow in place, Puget Sound', 'bear_milling_national': 'B. Bear Milling, lab-to-lab, remote national',
 'tri_certified_national': 'C. TRI matrix certified lab, remote (base and high include the FDA registration TRI requires)',
 'soc_remote': 'D. South OC, remote plus visits', 'soc_office': 'E. South OC consultation / pickup office',
 'soc_satellite_qc': 'F. South OC staffed finishing / QC satellite', 'soc_production_lab': 'G. South OC production lab',
 'maui_remote': 'H. Maui, remote plus 2 to 3 visits a year', 'maui_office': 'I. Maui case-coordination office',
 'alaska_remote': 'J. Alaska, remote, 2-day and overnight air', 'dfw_remote': 'K. DFW, remote', 'miami_remote': 'L. Miami, remote',
 'equipment_national': 'M. Equipment dealer motion, national, no premises', 'soc_equipment_showroom': 'N. South OC equipment demo / training room',
}
SHORT2 = {k: v.split(',')[0].split(' (')[0] for k, v in SHORT.items()}
CONF = {
 'bellevue_grow': 'Medium; the only option that cuts the two-client concentration, but no agent found evidence the Eastside is underserved and local conversion data is one trial account',
 'bear_milling_national': 'Medium; prices verified against three milling centers, demand not; competes for the same CAM and finishing hours',
 'tri_certified_national': 'Medium; would rank near the top without the FDA registration fee or with TRI referrals',
 'soc_remote': 'Medium; cheap because of family lodging, hardest lab market in the country',
 'soc_office': 'High that it loses money', 'soc_satellite_qc': 'High', 'soc_production_lab': 'High',
 'maui_remote': 'Medium-high; a 2-day flat-rate lane makes crowns viable, the market is small and self-milling',
 'maui_office': 'High', 'alaska_remote': 'Medium-low; its high quantitative score is cheapness, relationships are zero',
 'dfw_remote': 'High that it is a poor fit', 'miami_remote': 'High that it is a poor fit',
 'equipment_national': 'Low; 0 of 15 closed, outcome is binary', 'soc_equipment_showroom': 'High',
}
def neg(x):
    return money(x).replace('-$', '−$')

def t_cost_summary():
    L = ['| Option | Cash to open | First 90 days (no revenue) | Monthly cash | Monthly fully loaded | First-year cash | Exit exposure |', '|---|---|---|---|---|---|---|']
    for k in INP['options']:
        c, o = option_costs(k)
        col = lambda f: rng((c['low'][f], c['base'][f], c['high'][f]))
        L.append(f"| {SHORT[k]} | {col('startup_cash')} | {col('first_90_days')} | {col('monthly_cash')} | {col('monthly_fully_loaded')} | {col('first_year_cash')} | {col('exit_exposure')} |")
    return '\n'.join(L)

UE = [('fcz_crown', 'king_county', 'Zirconia crown, delivered in King County'),
      ('fcz_crown', 'ups_ground_2day', 'Zirconia crown, UPS Ground or 2-Day both ways (West Coast)'),
      ('fcz_crown', 'hawaii_2day_flat_rate', 'Zirconia crown, 2-day flat rate both ways (Hawaii)'),
      ('fcz_crown', 'overnight_hi_ak', 'Zirconia crown, carrier-list overnight or 2-day air both ways (Hawaii or Alaska)'),
      ('fcz_crown', 'alaska_2day_air', 'Zirconia crown, FedEx One Rate 2Day and overnight both ways (Anchorage)'),
      ('fcz_crown', 'two_day_national', 'Zirconia crown, 2-Day air both ways (Texas or Florida)'),
      ('implant_crown', 'king_county', 'Implant crown package, King County'),
      ('implant_crown', 'hawaii_2day_flat_rate', 'Implant crown package, Hawaii flat rate'),
      ('implant_crown', 'alaska_2day_air', 'Implant crown package, Anchorage'),
      ('full_arch_zr', 'king_county', 'Full-arch zirconia final, King County'),
      ('full_arch_zr', 'hawaii_2day_flat_rate', 'Full-arch zirconia final, Hawaii flat rate'),
      ('night_guard', 'king_county', 'Night guard, King County'),
      ('bear_crown', 'lab_to_lab_ground', 'Lab-to-lab crown mill-only, labs pay inbound'),
      ('bear_arch', 'lab_to_lab_ground', 'Lab-to-lab full arch from STL'),
      ('ti_bar', 'lab_to_lab_ground', 'Lab-to-lab titanium bar'),
      ('tri_matrix_mill_lab', 'lab_to_lab_ground', 'TRI matrix crown milled for another lab at $55 (certified center only; Vital\'s price from Spectrum Killian)'),
      ('tri_matrix_crown', 'ups_ground_2day', 'TRI matrix crown, West Coast ground'),
      ('machine_sale', 'none', 'ARUM mill sale'), ('millbox_license', 'none', 'MillBox license resale'), ('field_service_day', 'none', 'On-site CAD/CAM service day')]
def t_unit_econ():
    L = ['| Product and lane | Price (base) | Contribution per unit (pessimistic / base / optimistic) | Base margin |', '|---|---|---|---|']
    for prod, lane, label in UE:
        c, p = unit_contribution(prod, lane)
        est = ' (est.)' if prod == 'tri_matrix_crown' else (' (your record)' if prod == 'tri_matrix_mill_lab' else '')
        L.append(f"| {label} | {money(p[1])}{est} | {neg(c[0])} / {neg(c[1])} / {neg(c[2])} | {c[1]/p[1]*100:.0f}% |")
    return '\n'.join(L)

def t_results():
    L = ['| Option | Accounts at month 12 (lo / base / hi) | Revenue per account per month (base) | Year-1 revenue (base) | Year-1 cash after all option costs (base) | Year-1 profit after owner time (lo / base / hi) | Break-even accounts, cash / fully loaded (base) | Payback month (base) | Max drawdown incl. startup (base) |', '|---|---|---|---|---|---|---|---|---|']
    for k in INP['options']:
        dm = demand_model(k); b = dm['base']
        if k in ('equipment_national', 'soc_equipment_showroom'):
            acc = '1 / 3 / 7 machines a year (0.08 / 0.25 / 0.6 a month)' if k == 'equipment_national' else 'same as M plus arches'
            be = f"{b['breakeven_accounts_cash']:.1f} / {b['breakeven_accounts_fully_loaded']:.1f} machines a month"
        else:
            acc = f"{dm['low']['accounts_12m']:.0f} / {b['accounts_12m']:.0f} / {dm['high']['accounts_12m']:.0f}"
            be = f"{b['breakeven_accounts_cash']:.1f} / {b['breakeven_accounts_fully_loaded']:.1f}"
        pb = b['payback_month'] or 'none in 12 months'
        L.append(f"| {SHORT2[k]} | {acc} | {money(b['rev_per_acct'])} | {money(b['year1_revenue'])} | {neg(b['year1_cash_after_all'])} | {neg(dm['low']['year1_profit_after_owner_time'])} / {neg(b['year1_profit_after_owner_time'])} / {neg(dm['high']['year1_profit_after_owner_time'])} | {be} | {pb} | {neg(b['max_cash_drawdown'])} |")
    return '\n'.join(L)

def t_stress():
    L = ['| Option | Base month-12 | Half the accounts | Remake rate doubles | All monthly option costs +25% | Crown price matched to $109 | Lose one average account | Year-1 after owner time: base | Year-1: ramp 3 months slower |', '|---|---|---|---|---|---|---|---|---|']
    for k in INP['options']:
        if k in ('soc_satellite_qc', 'soc_production_lab', 'soc_equipment_showroom'):
            continue
        st = stress(k); b = demand_model(k)['base']
        cp = neg(st['crown_price_109']) if st['crown_price_109'] is not None else 'n/a'
        lab = SHORT2[k] + (' (lose one machine sale)' if k == 'equipment_national' else '')
        L.append(f"| {lab} | {neg(b['steady_monthly_cf_full'])} | {neg(st['half_accounts'])} | {neg(st['remake_doubles'])} | {neg(st['monthly_costs_plus_25pct'])} | {cp} | {neg(st['lose_one_account'])} | {neg(st['base_year1'])} | {neg(st['ramp_plus_3_year1'])} |")
    return '\n'.join(L)

def t_ranking():
    P = ranking.PROFILES
    rk = sorted(ranking.rows, key=lambda r: -ranking.total(r, P['Balanced (recommended)']))
    L = ['| Rank | Option | Profit | Cash | Time eff. | Downside | Fit | Evidence | Speed | Quant-only | Balanced | Cash-constrained | Growth-max | Lifestyle (OC family) | Confidence |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for i, r in enumerate(rk, 1):
        s = r['scores']
        L.append(f"| {i} | {SHORT2[r['key']]} | {s['profit']} | {s['cash']} | {s['time_eff']} | {s['downside']} | {s['fit']} | {s['evidence']} | {s['speed']} | {ranking.quant_only(r, P['Balanced (recommended)']):.2f} | {ranking.total(r, P['Balanced (recommended)']):.2f} | {ranking.total(r, P['Cash-constrained ($5k)']):.2f} | {ranking.total(r, P['Growth-max ($30k, risk ok)']):.2f} | {ranking.total(r, P['Lifestyle (be near family in OC)'], lifestyle=True):.2f} | {CONF[r['key']]} |")
    return '\n'.join(L)

TABLES = {'cost_summary': t_cost_summary, 'unit_econ': t_unit_econ, 'results': t_results, 'stress': t_stress, 'ranking': t_ranking}

def insert(report_path):
    s = open(report_path, encoding='utf-8').read()
    for name, fn in TABLES.items():
        a = f'<!-- TABLE:{name} -->'; b = f'<!-- /TABLE:{name} -->'
        if a not in s or b not in s:
            print('marker missing for', name); continue
        i = s.index(a) + len(a); j = s.index(b)
        s = s[:i] + '\n' + fn() + '\n' + s[j:]
    open(report_path, 'w', encoding='utf-8').write(s)
    print('tables inserted')

def orders():
    P = ranking.PROFILES
    for name, w in P.items():
        rk = sorted(ranking.rows, key=lambda r: -ranking.total(r, w, lifestyle=name.startswith('Lifestyle')))
        print(name, ' > '.join(f"{SHORT2[r['key']][0]} {ranking.total(r, w, lifestyle=name.startswith('Lifestyle')):.2f}" for r in rk[:6]))
    rkq = sorted(ranking.rows, key=lambda r: -ranking.quant_only(r, P['Balanced (recommended)']))
    print('quant', ' > '.join(f"{SHORT2[r['key']][0]} {ranking.quant_only(r, P['Balanced (recommended)']):.2f}" for r in rkq[:8]))

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'orders': orders()
    elif len(sys.argv) > 1: insert(sys.argv[1])
    else:
        for n, f in TABLES.items(): print(f'\n## {n}\n'); print(f())
