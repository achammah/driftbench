"""HF7 item bank: (field, gold, candidate, truth, subtype) for stored values with no stated format.

Deterministic (seed 7007). Writes data/hf7_items.json. Values are the fictional Acme ones (phones of area
code 202, exchange 555, lines 0100 to 0199, emails at example.com, Acmeville addresses), plus three made-up
customers. Every phone of the bank, near misses included, stays in lines 0100 to 0199: the two-digit near miss
swaps the last two digits of the line, or, when they are equal, changes both.
"""

from __future__ import annotations

import json
import random

from common import DATA

SEED = 7007

FIELDS = {
    "phone": "customer.phone of notify_sales: the customer's phone number, stored on a sales lead so a human advisor can call them back. No format is stated.",
    "email": "customer.email of notify_sales: the customer's email address, stored on a sales lead so a human advisor can write to them. No format is stated.",
    "address": "address of a sales lead: the customer's street address, stored so a human advisor knows where the service is wanted. No format is stated.",
}

PHONES = ["+12025550131", "+12025550188", "+12025550142", "+12025550118", "+12025550125", "+12025550150", "+12025550160", "+12025550165"]
EMAILS = ["sam.rivera@example.com", "lee.jensen@example.com", "morgan.diaz@example.com",
          "alex.chen@example.com", "jo.baker@example.com", "pat.okafor@example.com"]
ADDRESSES = [("14", "Harbor", "Road", "Rd"), ("3", "Orchard", "Way", "Wy"), ("88", "Summit", "Avenue", "Ave"), ("7", "Quarry", "Lane", "Ln")]
CONTENTLESS = ["", "N/A", "{field}", "unknown", ":", "Thought process:"]


def phone_forms(e164: str) -> list[str]:
    d = e164[2:]
    a, b, c = d[:3], d[3:6], d[6:]
    return [f"+1 {a} {b} {c}", f"({a}) {b}-{c}", f"{a}.{b}.{c}", f"{a}-{b}-{c}"]


def addr(num: str, street: str, typ: str) -> str:
    return f"{num} {street} {typ}, Acmeville"


def build() -> list[dict]:
    rng = random.Random(SEED)
    items = []

    def add(field, gold, cand, truth, sub):
        items.append({"id": f"I{len(items):03d}", "field": field, "gold": gold, "candidate": cand, "truth": truth, "subtype": sub})

    # phones: 4 positives, 3 near misses each
    for i, g in enumerate(PHONES):
        for f in phone_forms(g):
            add("phone", g, f, "same", "format")
        d = g[2:]
        last = d[-1]
        changed = d[:-1] + str((int(last) + 1) % 10)
        add("phone", g, rng.choice(phone_forms("+1" + changed)), "different", "one_digit_changed")
        tail = list(d[6:])
        if tail[2] != tail[3]:
            tail[2], tail[3] = tail[3], tail[2]
        else:  # equal last digits: a swap changes nothing, so change both and stay in 0100-0199
            tail[2], tail[3] = str((int(tail[3]) + 3) % 10), str((int(tail[3]) + 4) % 10)
        swapped = d[:6] + "".join(tail)
        add("phone", g, rng.choice(phone_forms("+1" + swapped)), "different", "two_digits_swapped")
        other = PHONES[(i + 1) % len(PHONES)]
        add("phone", g, rng.choice(phone_forms(other)), "different", "another_customer")
    # emails: 2 positives, 3 near misses each
    for i, g in enumerate(EMAILS):
        local, dom = g.split("@")
        title = ".".join(p.capitalize() for p in local.split(".")) + "@" + dom
        add("email", g, title, "same", "format")
        add("email", g, g.upper(), "same", "format")
        k = len(local) - 1
        ch = local[k]
        changed = local[:k] + ("s" if ch != "s" else "z") + "@" + dom
        add("email", g, rng.choice([changed, changed.upper()]), "different", "one_char_changed")
        lst = list(local)
        j = next(k for k in range(len(lst) - 1) if lst[k] != lst[k + 1] and "." not in (lst[k], lst[k + 1]))
        lst[j], lst[j + 1] = lst[j + 1], lst[j]
        add("email", g, "".join(lst) + "@" + dom, "different", "two_chars_swapped")
        other = EMAILS[(i + 1) % len(EMAILS)]
        add("email", g, rng.choice([other, other.upper()]), "different", "another_customer")
    # addresses: 3 positives, 3 near misses each
    neighbour = {"14": "16", "3": "5", "88": "86", "7": "9"}
    digitmiss = {"14": "41", "3": "8", "88": "83", "7": "1"}
    for i, (num, street, full, ab) in enumerate(ADDRESSES):
        g = addr(num, street, full)
        add("address", g, addr(num, street, ab), "same", "format")
        add("address", g, f"{num} {street.lower()} {full.lower()} acmeville", "same", "format")
        add("address", g, g.upper(), "same", "format")
        add("address", g, addr(neighbour[num], street, rng.choice([full, ab])), "different", "neighbouring_number")
        add("address", g, addr(digitmiss[num], street, rng.choice([full, ab])), "different", "digit_changed_or_swapped")
        o = ADDRESSES[(i + 1) % len(ADDRESSES)]
        add("address", g, addr(o[0], o[1], rng.choice([o[2], o[3]])), "different", "another_customer")
    # contentless values, each field once, paired with the field's first gold
    for field, gold in (("phone", PHONES[0]), ("email", EMAILS[0]), ("address", addr(*ADDRESSES[0][:3]))):
        for c in CONTENTLESS:
            add(field, gold, c.replace("{field}", field), "different", "contentless")
    return items


if __name__ == "__main__":
    items = build()
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "hf7_items.json").write_text(json.dumps(items, indent=1))
    from collections import Counter
    print(len(items), Counter(i["truth"] for i in items), Counter((i["truth"], i["subtype"]) for i in items))
