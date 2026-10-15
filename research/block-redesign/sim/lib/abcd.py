"""ABCD loader (Chen et al. 2021, MIT licence). The raw file lives outside the repo: set ABCD_DIR."""
import ast, gzip, json, os, random, re
from collections import defaultdict

ABCD_DIR = os.environ.get("ABCD_DIR", "")
FAQ_FLOWS = {"single_item_query", "storewide_query"}

# One-line customer goal per subflow, written from the guideline subflow names and descriptions
# (guidelines.json). ABCD's own customer prompts are not released; these lines stand in for them and are
# the same in every arm and every hypothesis.
GOALS = {
    "recover_username": "You forgot your username and want to recover it.",
    "recover_password": "You forgot your password and want to get back into your account.",
    "reset_2fa": "You cannot log in because of two-factor authentication and want it reset.",
    "status_service_added": "A subscription service was added to your account that you did not ask for; you want to know why and get it fixed.",
    "status_service_removed": "A subscription service was removed from your account; you want to know why and get it back.",
    "status_shipping_question": "You have a question about the shipping included with your account.",
    "status_credit_missing": "A store credit or promotion you expected is missing from your account.",
    "manage_change_address": "You want to change the address on your account.",
    "manage_change_name": "You want to change the name on your account.",
    "manage_change_phone": "You want to change the phone number on your account.",
    "manage_payment_method": "You want to change the payment method on your account.",
    "status_mystery_fee": "There is a fee on your order that you do not recognise; you want to understand it and have it removed.",
    "status_delivery_time": "You want to know when your order will arrive.",
    "status_payment_method": "You want to check or change the payment method used on your order.",
    "status_quantity": "You received the wrong quantity of items in your order.",
    "manage_upgrade": "You want to upgrade the shipping on your order.",
    "manage_downgrade": "You want to downgrade the shipping on your order.",
    "manage_create": "You want to add an item to your order or place a new order.",
    "manage_cancel": "You want to cancel your order.",
    "refund_initiate": "You want a refund for an item you bought.",
    "refund_update": "You already asked for a refund and want to change how it is refunded.",
    "refund_status": "You asked for a refund earlier and want to know its status.",
    "return_stain": "You want to return an item because it has a stain.",
    "return_color": "You want to return an item because the colour is not what you expected.",
    "return_size": "You want to return an item because it is the wrong size.",
    "bad_price_competitor": "You found the item you bought cheaper at a competitor and want the difference back.",
    "bad_price_yesterday": "The item you bought yesterday is now cheaper and you want the difference back.",
    "out_of_stock_general": "Many items you want are out of stock and you want to know when they come back.",
    "out_of_stock_one_item": "One item you want is out of stock and you want to know when it comes back.",
    "promo_code_invalid": "Your promo code is rejected as invalid.",
    "promo_code_out_of_date": "Your promo code is rejected because it says it has expired.",
    "mistimed_billing_already_returned": "You were charged for an item you already returned.",
    "mistimed_billing_never_bought": "You were charged for an item you never bought.",
    "status": "You want to know the shipping status of your order.",
    "manage": "You want to change the shipping address of your order.",
    "missing": "An item is missing from your delivery.",
    "cost": "You have a question about the shipping cost of your order.",
    "status_active": "You want to know whether your premium subscription is still active.",
    "status_due_amount": "You want to know how much you owe on your premium subscription.",
    "status_due_date": "You want to know when your premium subscription payment is due.",
    "manage_pay_bill": "You want to pay your premium subscription bill.",
    "manage_extension": "You want an extension on your premium subscription payment.",
    "manage_dispute_bill": "You want to dispute a charge on your premium subscription bill.",
    "credit_card": "The website keeps rejecting your credit card.",
    "shopping_cart": "Your shopping cart on the website is not updating.",
    "search_results": "The website search is not returning results.",
    "slow_speed": "The website is very slow.",
}

FAQ_BUTTONS = {"search-faq", "select-faq", "search-jeans", "search-shirt", "search-boots", "search-jacket",
               "search-pricing", "search-timing", "search-membership", "search-policy"}

_DATA = None


def load():
    global _DATA
    if _DATA is None:
        _DATA = json.load(gzip.open(os.path.join(ABCD_DIR, "abcd_v1.1.json.gz")))
    return _DATA


def action_flow(conv):
    return conv["scenario"]["flow"] not in FAQ_FLOWS


def by_id(split):
    return {c["convo_id"]: c for c in load()[split]}


def gold_buttons(conv):
    return sorted({t["targets"][2] for t in conv["delexed"] if t["speaker"] == "action"})


def customer_turns(conv):
    """Consecutive customer messages merged into one turn (action rows do not break a turn)."""
    turns, cur, last = [], [], None
    for spk, text in conv["original"]:
        if spk == "action":
            continue
        if spk == "customer":
            if last == "customer":
                cur.append(text)
            else:
                cur = [text]
                turns.append(cur)
        last = spk
    return [" ".join(t).strip() for t in turns]


def facts(conv):
    """Customer facts from the scenario, as (slot, value) pairs."""
    s = conv["scenario"]
    out = {}
    for k, v in s["personal"].items():
        if v not in (None, ""):
            out[k] = str(v)
    o = s["order"]
    for k in ("order_id", "full_address", "zip_code", "payment_method", "purchase_date", "shipping_status", "packaging"):
        if o.get(k) not in (None, ""):
            out[k] = str(o[k])
    if s["order"].get("products"):
        try:
            prods = ast.literal_eval(s["order"]["products"])
            out["items_in_order"] = "; ".join(f"{p['brand'].replace('_', ' ')} {p['product_type']} (${p['amount']})" for p in prods)
        except Exception:
            pass
    names = s.get("product", {}).get("names") or []
    amounts = s.get("product", {}).get("amounts") or []
    if names:
        out["product_concerned"] = "; ".join(f"{n.replace('_', ' ')} (${a})" for n, a in zip(names, amounts))
    return out


def goal(conv):
    return GOALS[conv["scenario"]["subflow"]]


def stratified_sample(convs, n, rng):
    by_flow = defaultdict(list)
    for c in convs:
        by_flow[c["scenario"]["flow"]].append(c)
    flows = sorted(by_flow)
    total = len(convs)
    alloc = {f: (n * len(by_flow[f])) // total for f in flows}
    rest = n - sum(alloc.values())
    for f in sorted(flows, key=lambda f: -len(by_flow[f]))[:rest]:
        alloc[f] += 1
    out = []
    for f in flows:
        pool = sorted(by_flow[f], key=lambda c: c["convo_id"])
        out.extend(rng.sample(pool, alloc[f]))
    return out


def flow_balanced_sample(convs, n, rng):
    """H11: 2 or 3 per flow, extra slots to the largest flows."""
    by_flow = defaultdict(list)
    for c in convs:
        by_flow[c["scenario"]["flow"]].append(c)
    flows = sorted(by_flow)
    base = n // len(flows)
    alloc = {f: base for f in flows}
    for f in sorted(flows, key=lambda f: (-len(by_flow[f]), f))[: n - base * len(flows)]:
        alloc[f] += 1
    out = []
    for f in flows:
        pool = sorted(by_flow[f], key=lambda c: c["convo_id"])
        out.extend(rng.sample(pool, alloc[f]))
    return out
