"""
Integra Dental growth-option model.
All inputs live in inputs.json so every number is visible and editable.
Outputs: markdown tables for the report (printed to stdout and written to outputs.md).

Conventions
- Money in USD. "monthly" costs are fully loaded recurring costs of the OPTION only
  (Bellevue overhead is NOT included, to avoid double counting).
- low / base / high scenarios for acquisition; low/base/high for costs are carried as (lo, base, hi) tuples.
- Owner time is charged at an explicit opportunity-cost rate (inputs.owner_hour_value) so
  "free" owner labour is never free in the model.
"""
import json, math, sys, os
from copy import deepcopy

HERE = os.path.dirname(os.path.abspath(__file__))
INP = json.load(open(os.path.join(HERE, "inputs.json")))

def tri(x):
    """Accept a number or [lo, base, hi]; return (lo, base, hi)."""
    if isinstance(x, (int, float)):
        return (float(x), float(x), float(x))
    lo, b, hi = x
    return (float(lo), float(b), float(hi))

def money(v, nd=0):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "n/a"
    s = f"{abs(v):,.{nd}f}"
    return f"-${s}" if v < 0 else f"${s}"

def rng(t, nd=0):
    lo, b, hi = t
    if abs(lo - hi) < 0.5:
        return money(b, nd)
    return f"{money(lo, nd)} / {money(b, nd)} / {money(hi, nd)}"

# ---------------------------------------------------------------------------
# 1. Unit economics (contribution per unit sold, by product and channel)
# ---------------------------------------------------------------------------
def unit_contribution(product, shipping_lane="king_county", remake_mult=1.0, price_override=None):
    p = INP["products"][product]
    lane = INP["shipping_lanes"][shipping_lane]
    price = tri(p["price"]) if price_override is None else tri(price_override)
    mat = tri(p["materials"])
    labor_hours = tri(p["labor_hours"])
    labor_rate = tri(INP["labor"]["loaded_tech_rate"])
    # per-case shipping both ways, divided by units per case
    units_per_case = tri(p.get("units_per_case", 1))
    ship_rt = tri(lane["round_trip_cost"])  # per case round trip (outbound + inbound label)
    remake = tuple(r * remake_mult for r in tri(p.get("remake_rate", INP["ops"]["remake_rate"])))
    fee = tri(INP["ops"]["payment_fee_pct"])
    out = []
    for i in range(3):
        ship_per_unit = ship_rt[i] / max(units_per_case[i], 1)
        gross = price[i]
        cost = mat[i] + labor_hours[i] * labor_rate[i] + ship_per_unit + fee[i] * price[i]
        # remakes cost materials+labor again on a fraction of units
        cost += remake[i] * (mat[i] + labor_hours[i] * labor_rate[i] + ship_per_unit)
        out.append(gross - cost)
    # order so lo is the pessimistic contribution: pessimistic = low price, high cost
    lo = price[0] - (mat[2] + labor_hours[2] * labor_rate[2] + ship_rt[2] / max(units_per_case[0], 1) + fee[2] * price[0]) * (1 + remake[2])
    hi = price[2] - (mat[0] + labor_hours[0] * labor_rate[0] + ship_rt[0] / max(units_per_case[2], 1) + fee[0] * price[2]) * (1 + remake[0])
    return (lo, out[1], hi), price

# ---------------------------------------------------------------------------
# 2. Option cost stack (startup, 90-day, monthly, first-year, commitment, reserve)
# ---------------------------------------------------------------------------
def option_costs(opt):
    o = INP["options"][opt]
    one_time = {k: tri(v) for k, v in o.get("one_time", {}).items()}
    deposits = {k: tri(v) for k, v in o.get("refundable_deposits", {}).items()}
    monthly = {k: tri(v) for k, v in o.get("monthly", {}).items()}
    annual = {k: tri(v) for k, v in o.get("annual", {}).items()}
    per_trip = {k: tri(v) for k, v in o.get("per_trip", {}).items()}
    trips_per_month = tri(o.get("trips_per_month", 0))
    owner_hours_month = tri(o.get("owner_hours_per_month", 0))
    owner_rate = tri(INP["owner_hour_value"])
    term_months = o.get("min_term_months", 0)
    notice_months = o.get("exit_notice_months", 0)

    def s(d, i):
        return sum(v[i] for v in d.values())

    res = {}
    for i, name in enumerate(["low", "base", "high"]):
        trip_cost = s(per_trip, i) * trips_per_month[i]
        owner_cost = owner_hours_month[i] * owner_rate[i]
        m_cash = s(monthly, i) + s(annual, i) / 12 + trip_cost           # cash cost per month
        m_full = m_cash + owner_cost                                      # fully loaded incl. owner time
        startup_exp = s(one_time, i)
        startup_dep = s(deposits, i)
        startup_cash = startup_exp + startup_dep + o.get("prepaid_rent_months", 0) * monthly.get("rent", (0,0,0))[i]
        prepaid = o.get("prepaid_rent_months", 0) * monthly.get("rent", (0,0,0))[i]
        first90 = startup_cash + 3 * m_cash - prepaid          # prepaid month of rent is in startup_cash, so month 1 rent is not charged again
        reserve = o.get("reserve_months", 3) * m_cash
        year1 = startup_cash + 12 * m_cash - prepaid
        exposure = startup_exp + max(term_months, notice_months) * monthly.get("rent", (0,0,0))[i] \
                   + max(term_months, notice_months) * sum(v[i] for k, v in monthly.items() if k in o.get("committed_monthly_keys", ["rent"]) and k != "rent")
        res[name] = dict(startup_expenses=startup_exp, refundable_deposits=startup_dep, startup_cash=startup_cash, prepaid_rent=prepaid,
                         monthly_cash=m_cash, monthly_owner_time=owner_cost, monthly_fully_loaded=m_full,
                         first_90_days=first90, first_year_cash=year1, reserve=reserve,
                         first_year_plus_reserve=year1 + reserve, exit_exposure=exposure)
    return res, o

# ---------------------------------------------------------------------------
# 3. Demand / acquisition model for an option
# ---------------------------------------------------------------------------
def demand_model(opt, remake_mult=1.0, price_override=None, ramp_shift=0, accounts_mult=1.0):
    """Accounts ramp linearly from 0 to accounts_12m over ramp_months; each account sends units per month
    of mix; contribution per unit computed from unit economics on the option's shipping lane.
    remake_mult, price_override ({product: price}), ramp_shift (months) and accounts_mult are stress hooks."""
    o = INP["options"][opt]
    d = o["demand"]
    lane = o.get("shipping_lane", "king_county")
    comm_pct = tri(o.get("commission_pct_of_revenue", 0))
    out = {}
    for i, name in enumerate(["low", "base", "high"]):
        accts12 = tri(d["accounts_12m"])[i] * accounts_mult
        ramp = tri(d.get("ramp_months", 9))[i] + ramp_shift
        mix = d["case_mix"]  # product -> cases per account per month (tri)
        contrib_per_acct = 0.0
        rev_per_acct = 0.0
        labor_hours_per_acct = 0.0
        units_per_acct = 0.0
        for prod, n in mix.items():
            po = (price_override or {}).get(prod)
            c, price = unit_contribution(prod, lane, remake_mult=remake_mult, price_override=po)
            n_i = tri(n)[i]                      # units per account per month
            contrib_per_acct += n_i * c[i]
            rev_per_acct += n_i * price[i]
            labor_hours_per_acct += n_i * tri(INP["products"][prod]["labor_hours"])[i]
            units_per_acct += n_i
        # month-by-month ramp
        months = []
        cum_cf = 0.0
        costs, _ = option_costs(opt)
        cst = costs[name]
        cum_cf -= cst["startup_cash"]
        breakeven_month = None
        payback_month = None
        for m in range(1, 13):
            accts = accts12 * min(m / ramp, 1.0)
            rev = accts * rev_per_acct
            contrib = accts * contrib_per_acct
            comm = comm_pct[i] * rev                           # sales commission as a percentage of revenue
            addback = cst.get("prepaid_rent", 0) if m == 1 else 0  # month-1 rent was prepaid in startup cash
            cf = contrib - comm - cst["monthly_cash"] + addback   # cash view (owner time excluded)
            cf_full = contrib - comm - cst["monthly_fully_loaded"] + addback
            cum_cf += cf
            if breakeven_month is None and cf_full >= 0:
                breakeven_month = m
            if payback_month is None and cum_cf >= 0:
                payback_month = m
            months.append(dict(month=m, accounts=accts, revenue=rev, contribution=contrib, cash_flow=cf, cash_flow_full=cf_full, cum_cash=cum_cf))
        yr_rev = sum(x["revenue"] for x in months)
        yr_contrib = sum(x["contribution"] for x in months)
        yr_cf = sum(x["cash_flow"] for x in months) - cst["startup_cash"]
        yr_cf_full = sum(x["cash_flow_full"] for x in months) - cst["startup_cash"]
        # steady-state (month 12) numbers
        ss = months[-1]
        net_contrib_per_acct = contrib_per_acct - comm_pct[i] * rev_per_acct
        be_accounts = cst["monthly_fully_loaded"] / net_contrib_per_acct if net_contrib_per_acct > 0 else float("inf")
        be_accounts_cash = cst["monthly_cash"] / net_contrib_per_acct if net_contrib_per_acct > 0 else float("inf")
        min_cum = min([-cst["startup_cash"]] + [x["cum_cash"] for x in months])   # includes the pre-revenue outlay
        cap = INP["capacity"]
        hours_m12 = accts12 * labor_hours_per_acct
        units_m12 = accts12 * units_per_acct
        out[name] = dict(accounts_12m=accts12, rev_per_acct=rev_per_acct, contrib_per_acct=net_contrib_per_acct, gross_contrib_per_acct=contrib_per_acct,
                         labor_hours_month12=hours_m12, units_month12=units_m12,
                         capacity_flag=("HIRE" if hours_m12 > cap["spare_production_hours_per_month"] else "ok"),
                         year1_revenue=yr_rev, year1_contribution=yr_contrib, year1_cash_after_all=yr_cf,
                         year1_profit_after_owner_time=yr_cf_full, steady_monthly_revenue=ss["revenue"],
                         steady_monthly_cf=ss["cash_flow"], steady_monthly_cf_full=ss["cash_flow_full"],
                         breakeven_accounts_fully_loaded=be_accounts, breakeven_accounts_cash=be_accounts_cash,
                         month_positive_cf_full=breakeven_month, payback_month=payback_month,
                         max_cash_drawdown=min_cum, months=months)
    return out

# ---------------------------------------------------------------------------
# 4. Stress tests on base case
# ---------------------------------------------------------------------------
def stress(opt):
    """Base-case stresses. Month-12 monthly cash flow after owner time unless noted."""
    base = demand_model(opt)["base"]
    costs, o = option_costs(opt)
    cst = costs["base"]
    res = {}
    # slow acquisition: half the accounts at month 12 (recomputed through the model)
    res["half_accounts"] = demand_model(opt, accounts_mult=0.5)["base"]["steady_monthly_cf_full"]
    # remake rate doubles: recomputed through unit economics (remakes cost materials, labor and shipping again)
    res["remake_doubles"] = demand_model(opt, remake_mult=2.0)["base"]["steady_monthly_cf_full"]
    # all monthly option costs +25% (rent, pass-throughs, staff, marketing, travel): bites on every option
    res["monthly_costs_plus_25pct"] = base["steady_monthly_cf_full"] - 0.25 * cst["monthly_cash"]
    # crown price pressure: zirconia crown matched to Glidewell's $109 list (options that sell fcz_crown)
    if "fcz_crown" in o["demand"]["case_mix"]:
        res["crown_price_109"] = demand_model(opt, price_override={"fcz_crown": [99, 109, 109]})["base"]["steady_monthly_cf_full"]
    else:
        res["crown_price_109"] = None
    # ramp three months slower: year-1 profit after owner time (month-12 cash flow is unchanged by timing)
    res["ramp_plus_3_year1"] = demand_model(opt, ramp_shift=3)["base"]["year1_profit_after_owner_time"]
    res["base_year1"] = base["year1_profit_after_owner_time"]
    # lose one average account (or, for equipment options, one unit of the key product averaged over a year)
    lose_unit = o["demand"].get("stress_lose_unit")
    if lose_unit:
        c, _ = unit_contribution(lose_unit, o.get("shipping_lane", "none"))
        res["lose_one_account"] = base["steady_monthly_cf_full"] - c[1] / 12.0
    else:
        res["lose_one_account"] = base["steady_monthly_cf_full"] - base["contrib_per_acct"]
    return res

# ---------------------------------------------------------------------------
# 5. Feasibility by cash envelope
# ---------------------------------------------------------------------------
def feasibility(opt):
    costs, _ = option_costs(opt)
    dm = demand_model(opt)
    rows = {}
    for env in INP["cash_envelopes"]:
        verdict = {}
        for name in ["low", "base", "high"]:
            need = costs[name]["first_90_days"]                       # cash to open and run 90 days with zero revenue
            need_dd = -dm[name]["max_cash_drawdown"]                   # worst cumulative drawdown with base ramp
            ok = env >= need and env >= need_dd
            verdict[name] = dict(first90=need, max_drawdown=need_dd, feasible=ok)
        rows[env] = verdict
    return rows

# ---------------------------------------------------------------------------
# Report rendering
# ---------------------------------------------------------------------------
def render():
    L = []
    L.append("# Model outputs (generated by model.py from inputs.json)\n")
    L.append(f"Owner opportunity cost used: {rng(tri(INP['owner_hour_value']))} per hour. Loaded technician rate: {rng(tri(INP['labor']['loaded_tech_rate']))} per hour.\n")
    L.append("## Unit economics by product and shipping lane\n")
    L.append("| Product | Lane | Price (lo/base/hi) | Contribution per unit (pessimistic / base / optimistic) | Margin at base |")
    L.append("|---|---|---|---|---|")
    for prod in INP["products"]:
        for lane in INP["products"][prod].get("lanes", ["king_county", "ups_ground_2day", "overnight_hi_ak"]):
            c, price = unit_contribution(prod, lane)
            L.append(f"| {INP['products'][prod]['label']} | {INP['shipping_lanes'][lane]['label']} | {rng(price)} | {rng(c)} | {c[1]/price[1]*100:.0f}% |")
    L.append("")
    L.append("## Option cost stacks\n")
    hdr = "| Option | Startup expenses | Refundable deposits | Cash to open | Monthly cash cost | Owner time / mo | Monthly fully loaded | First 90 days | First-year cash | Reserve | Year 1 + reserve | Min commitment / exit exposure |"
    L.append(hdr)
    L.append("|" + "---|" * 12)
    for opt in INP["options"]:
        c, o = option_costs(opt)
        def col(k):
            return rng((c["low"][k], c["base"][k], c["high"][k]))
        L.append(f"| {o['label']} | {col('startup_expenses')} | {col('refundable_deposits')} | {col('startup_cash')} | {col('monthly_cash')} | {col('monthly_owner_time')} | {col('monthly_fully_loaded')} | {col('first_90_days')} | {col('first_year_cash')} | {col('reserve')} | {col('first_year_plus_reserve')} | {o.get('min_term_months',0)} mo term; {col('exit_exposure')} |")
    L.append("")
    L.append("## Demand, break-even, payback (12-month view)\n")
    L.append("| Option | Scenario | Accounts at month 12 | Revenue / account / mo | Contribution / account / mo | Year-1 revenue | Year-1 cash after startup & option costs | Year-1 profit after owner time | Month-12 monthly cash flow | Break-even accounts (cash / fully loaded) | First month positive (fully loaded) | Payback month | Max cash drawdown | Units & labor hrs at month 12 | Capacity |")
    L.append("|" + "---|" * 15)
    for opt in INP["options"]:
        dm = demand_model(opt)
        o = INP["options"][opt]
        for name in ["low", "base", "high"]:
            d = dm[name]
            L.append(f"| {o['label']} | {name} | {d['accounts_12m']:.1f} | {money(d['rev_per_acct'])} | {money(d['contrib_per_acct'])} | {money(d['year1_revenue'])} | {money(d['year1_cash_after_all'])} | {money(d['year1_profit_after_owner_time'])} | {money(d['steady_monthly_cf'])} | {d['breakeven_accounts_cash']:.1f} / {d['breakeven_accounts_fully_loaded']:.1f} | {d['month_positive_cf_full'] or 'not in 12 mo'} | {d['payback_month'] or 'not in 12 mo'} | {money(d['max_cash_drawdown'])} | {d['units_month12']:.0f} u / {d['labor_hours_month12']:.0f} h | {d['capacity_flag']} |")
    L.append("")
    L.append("## Stress tests (base case; month-12 monthly cash flow after owner time unless noted)\n")
    L.append("| Option | Base month-12 | Half the accounts | Remake rate doubles | All monthly option costs +25% | Crown price matched to $109 | Lose one average account | Year-1 profit after owner time: base | Year-1 profit: ramp 3 months slower |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for opt in INP["options"]:
        st = stress(opt); b = demand_model(opt)["base"]
        cp = money(st["crown_price_109"]) if st["crown_price_109"] is not None else "n/a"
        L.append(f"| {INP['options'][opt]['label']} | {money(b['steady_monthly_cf_full'])} | {money(st['half_accounts'])} | {money(st['remake_doubles'])} | {money(st['monthly_costs_plus_25pct'])} | {cp} | {money(st['lose_one_account'])} | {money(st['base_year1'])} | {money(st['ramp_plus_3_year1'])} |")
    L.append("")
    L.append("## Feasibility by expansion-cash envelope\n")
    L.append("Feasible = envelope covers both (a) cash to open plus 90 days of option costs with zero revenue and (b) the worst cumulative drawdown in the ramp scenario.\n")
    L.append("| Option | Scenario | Need: open + 90 days | Need: worst drawdown | $5,000 | $15,000 | $30,000 |")
    L.append("|---|---|---|---|---|---|---|")
    for opt in INP["options"]:
        f = feasibility(opt)
        for name in ["low", "base", "high"]:
            r5, r15, r30 = f[5000][name], f[15000][name], f[30000][name]
            L.append(f"| {INP['options'][opt]['label']} | {name} | {money(r5['first90'])} | {money(r5['max_drawdown'])} | {'yes' if r5['feasible'] else 'no'} | {'yes' if r15['feasible'] else 'no'} | {'yes' if r30['feasible'] else 'no'} |")
    L.append("")
    return "\n".join(L)

if __name__ == "__main__":
    out = render()
    open(os.path.join(HERE, "outputs.md"), "w").write(out)
    print(out)
