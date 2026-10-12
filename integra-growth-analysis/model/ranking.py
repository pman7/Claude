"""Transparent weighted ranking of geography x service x customer combinations.
Scores 1-5 per criterion; weights sum to 100. Three weighting profiles show sensitivity.
Inputs: base-case model outputs (model.py) plus analyst judgement scores recorded here with reasons."""
import json, os
from model import demand_model, option_costs, INP

HERE = os.path.dirname(os.path.abspath(__file__))

# Analyst scores (1 = worst, 5 = best). Reasons are written next to each score so they can be argued with.
J = {
 "bellevue_grow":        dict(fit=5, evidence=4, speed=4, reason="Uses existing capacity, relationships (Jung, Keller, Study Club HQ 15 min away), no lease; implant/full-arch practices named; main risk is founder attention and ops reliability"),
 "tri_certified_national": dict(fit=5, evidence=3, speed=3, reason="Certification in progress, local TRI users (Keller) and TRI USA relationship; Glidewell is also certified, so moat is local same-day service, not certification itself; TRI requires FDA establishment registration ($13,785/yr FY2027) as a condition, which is now in the cost stack"),
 "bear_milling_national":  dict(fit=4, evidence=3, speed=3, reason="Fills idle spindles; prices verified against Monster/Haus/Alien; thin crown margins, full-arch and bars carry it; owner deprioritized it in Sept"),
 "equipment_national":     dict(fit=4, evidence=2, speed=2, reason="Dealer rights real, 0 of 15 closed in 7 months, long cycles, cash-float risk on financed deals; one close = ~$17K gross"),
 "soc_remote":             dict(fit=3, evidence=3, speed=2, reason="Most lab-saturated county in the US (CA 734 labs; Glidewell HQ; TRI USA in Santa Ana); family visits make travel cheap; one existing account"),
 "alaska_remote":          dict(fit=3, evidence=3, speed=2, reason="Seattle is Alaska's hub, overnight is real, highest dentists per capita; but Anchorage has several digital labs; no relationships yet"),
 "maui_remote":            dict(fit=2, evidence=3, speed=2, reason="116 dentists on Maui, no standalone lab found, but Oahu has 25+ labs and mainland labs already ship 2-day; shipping kills single-unit margin; warm leads exist"),
 "soc_office":             dict(fit=2, evidence=3, speed=1, reason="Office adds nexus, $800/yr tax, 12-mo lease, and no production; conversion lift over remote is speculative"),
 "soc_equipment_showroom": dict(fit=2, evidence=2, speed=1, reason="ARUM USA HQ is in Irvine; a dealer showroom in the OEM's backyard duplicates the OEM; needs $35K+ cash"),
 "dfw_remote":             dict(fit=1, evidence=3, speed=1, reason="No structural advantage; TX lab registration/CDT questions; many local labs and milling centers (Monster, Haus are in DFW)"),
 "miami_remote":           dict(fit=1, evidence=3, speed=1, reason="Full-arch centers mostly have in-house labs; dense low-price lab market; 5-day ground"),
 "maui_office":            dict(fit=1, evidence=3, speed=1, reason="Lease + GET + travel for 2-5 accounts; negative in every scenario"),
 "soc_satellite_qc":       dict(fit=2, evidence=2, speed=1, reason="$36K-$107K first-90-days; break-even needs 13+ accounts; infeasible at all envelopes"),
 "soc_production_lab":     dict(fit=2, evidence=2, speed=1, reason="$160K+ first 90 days; infeasible"),
}

def band(x, cuts, reverse=False):
    """Map a number to 1..5 given 4 ascending cut points."""
    s = 1
    for c in cuts:
        if x >= c: s += 1
    return (6 - s) if reverse else s

rows = []
for key, j in J.items():
    dm = demand_model(key)["base"]
    cs = option_costs(key)[0]["base"]
    contrib = dm["year1_profit_after_owner_time"]           # year-1 incremental profit after all option costs and owner time
    cash = cs["first_90_days"]                               # cash to open + 90 days
    exposure = cs["exit_exposure"]
    hours = INP["options"][key].get("owner_hours_per_month", [0,0,0])
    hrs = hours[1] if isinstance(hours, list) else hours
    eff = (dm["steady_monthly_cf"] / hrs) if hrs else 0      # month-12 cash flow per owner hour
    scores = {
        "profit":   band(contrib, [-20000, 0, 10000, 30000]),
        "cash":     band(cash, [2500, 5000, 10000, 20000], reverse=True),
        "time_eff": band(eff, [0, 50, 100, 200]),
        "downside": band(exposure, [1000, 3000, 10000, 30000], reverse=True),
        "fit":      j["fit"],
        "evidence": j["evidence"],
        "speed":    j["speed"],
    }
    rows.append(dict(key=key, label=INP["options"][key]["label"], scores=scores, contrib=contrib, cash=cash, exposure=exposure, eff=eff, reason=j["reason"]))

PROFILES = {
  "Balanced (recommended)":     dict(profit=25, cash=20, time_eff=15, downside=10, fit=15, evidence=10, speed=5),
  "Cash-constrained ($5k)":     dict(profit=15, cash=35, time_eff=15, downside=15, fit=10, evidence=10, speed=0),
  "Growth-max ($30k, risk ok)": dict(profit=35, cash=5,  time_eff=15, downside=5,  fit=20, evidence=10, speed=10),
  "Lifestyle (be near family in OC)": dict(profit=20, cash=15, time_eff=10, downside=10, fit=35, evidence=5, speed=5),
}
# lifestyle profile: bump fit for OC options
def total(r, w, lifestyle=False):
    sc = dict(r["scores"])
    if lifestyle and r["key"].startswith("soc_"):
        sc["fit"] = min(5, sc["fit"] + 2)
    return sum(sc[k] * w[k] for k in w) / 100.0

out = ["# Weighted ranking (generated by ranking.py)\n",
       "Scores 1-5. profit = year-1 incremental profit after all option costs and owner time (base case); cash = cash to open plus 90 days (lower is better); time_eff = month-12 cash flow per owner hour; downside = lease/exit exposure (lower is better); fit/evidence/speed = analyst judgement with reasons.\n",
       "| # | Option | profit | cash | time eff | downside | fit | evidence | speed | Balanced | Cash-constrained | Growth-max | Lifestyle | Base yr-1 profit | Open+90d cash | Exit exposure |",
       "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
ranked = sorted(rows, key=lambda r: -total(r, PROFILES["Balanced (recommended)"]))
for i, r in enumerate(ranked, 1):
    s = r["scores"]
    out.append(f"| {i} | {r['label']} | {s['profit']} | {s['cash']} | {s['time_eff']} | {s['downside']} | {s['fit']} | {s['evidence']} | {s['speed']} | "
               f"{total(r, PROFILES['Balanced (recommended)']):.2f} | {total(r, PROFILES['Cash-constrained ($5k)']):.2f} | {total(r, PROFILES['Growth-max ($30k, risk ok)']):.2f} | {total(r, PROFILES['Lifestyle (be near family in OC)'], lifestyle=True):.2f} | ${r['contrib']:,.0f} | ${r['cash']:,.0f} | ${r['exposure']:,.0f} |")
out.append("\n## Why each option scored as it did\n")
for r in ranked:
    out.append(f"- **{r['label']}** — {r['reason']}")
out.append("\n## Rank order under each weighting profile\n")
for name, w in PROFILES.items():
    rk = sorted(rows, key=lambda r: -total(r, w, lifestyle=name.startswith("Lifestyle")))
    out.append(f"- **{name}:** " + " > ".join(r["label"].split(".")[0] for r in rk))
txt = "\n".join(out)
open(os.path.join(HERE, "ranking.md"), "w").write(txt)
print(txt)
