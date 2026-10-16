"""Python port of examples/acme/src/store.ts and tools.ts (origin/main a7c3280c2).

Research stand-in only: the live Acme agent of the links experiments calls these tools. The data and the
rules are copied from the TypeScript; tool names use underscores because the Anthropic API takes no dot.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re

SEED = {
    "plans": [
        {"id": "mobile-s", "name": "Acme Mobile S", "category": "mobile", "monthly_usd": 15, "data_gb": 10},
        {"id": "mobile-m", "name": "Acme Mobile M", "category": "mobile", "monthly_usd": 25, "data_gb": 40},
        {"id": "mobile-l", "name": "Acme Mobile L", "category": "mobile", "monthly_usd": 35, "data_gb": None},
        {"id": "fiber-300", "name": "Acme Fiber 300", "category": "home", "monthly_usd": 40, "speed_mbps": 300, "access": "fiber"},
        {"id": "fiber-1000", "name": "Acme Fiber 1000", "category": "home", "monthly_usd": 60, "speed_mbps": 1000, "access": "fiber"},
        {"id": "air-5g", "name": "Acme Air 5G", "category": "home", "monthly_usd": 35, "speed_mbps": 200, "access": "5g"},
    ],
    "addresses": [
        {"id": "addr-101", "label": "14 Harbor Road, Acmeville", "fiber_mbps": 1000, "five_g": True},
        {"id": "addr-102", "label": "3 Orchard Way, Acmeville", "fiber_mbps": 300, "five_g": True},
        {"id": "addr-103", "label": "88 Summit Avenue, Acmeville", "fiber_mbps": 0, "five_g": True},
        {"id": "addr-104", "label": "7 Quarry Lane, Acmeville", "fiber_mbps": 0, "five_g": False},
    ],
    "customers": [
        {"id": "cust-001", "name": "Sam Rivera", "email": "sam.rivera@example.com", "phone": "+12025550142", "plan_id": "mobile-s"},
        {"id": "cust-002", "name": "Lee Jensen", "email": "lee.jensen@example.com", "phone": "+12025550118", "plan_id": "fiber-300", "address_id": "addr-102"},
        {"id": "cust-003", "name": "Morgan Diaz", "email": "morgan.diaz@example.com", "phone": "+12025550125", "plan_id": "mobile-l"},
    ],
    "port_numbers": [
        {"number": "+12025550160", "eligible": False, "reason": "the number has a transfer lock at its current carrier"},
        {"number": "+12025550165", "eligible": True},
    ],
}

SIDE_EFFECT = {"order_create", "notify_sales"}
LEAD_REASONS = {"callback", "no_coverage", "tool_failure", "order_failed"}


class InvalidInput(Exception):
    pass


def to_e164(raw: str):
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return None


def _allow_only(inp, keys):
    for k in inp:
        if k not in keys:
            raise InvalidInput(f"unknown parameter: {k}")


def _req_str(inp, key):
    v = inp.get(key)
    if not isinstance(v, str) or v.strip() == "":
        raise InvalidInput(f"{key} is required")
    return v


def _simplify(t: str) -> str:
    t = re.sub(r"[^a-z0-9 ]", " ", t.lower())
    return re.sub(r"\s+", " ", t).strip()


def _stable(v):
    if isinstance(v, list):
        return "[" + ",".join(_stable(x) for x in v) + "]"
    if isinstance(v, dict):
        keys = sorted(k for k in v if v[k] is not None or True)
        return "{" + ",".join(json.dumps(k) + ":" + _stable(v[k]) for k in keys) + "}"
    return json.dumps(v)


def _short_hash(v) -> str:
    return hashlib.sha256(_stable(v).encode()).hexdigest()[:6].upper()


def catalog_search(inp, data):
    _allow_only(inp, ["category", "customer_email", "address_id"])
    cat = inp.get("category")
    if cat not in ("mobile", "home"):
        raise InvalidInput("category must be mobile or home")
    plans = [p for p in data["plans"] if p["category"] == cat]
    if inp.get("address_id") is not None:
        if cat != "home":
            raise InvalidInput("address_id applies to home plans only")
        addr = next((a for a in data["addresses"] if a["id"] == inp["address_id"]), None)
        if not addr:
            raise InvalidInput(f"unknown address_id: {inp['address_id']}")
        plans = [p for p in plans if (addr["fiber_mbps"] >= p.get("speed_mbps", 0) if p.get("access") == "fiber" else addr["five_g"])]
    out = {"plans": [dict(p) for p in plans]}
    if inp.get("customer_email") is not None:
        email = _req_str(inp, "customer_email").lower()
        c = next((c for c in data["customers"] if c["email"] == email), None)
        out["customer"] = {"id": c["id"], "name": c["name"], "current_plan_id": c["plan_id"]} if c else None
    return out


def coverage_check(inp, data):
    _allow_only(inp, ["address"])
    wanted = _simplify(_req_str(inp, "address"))
    for a in data["addresses"]:
        street = _simplify(a["label"].split(",")[0])
        if wanted == _simplify(a["label"]) or wanted.startswith(street):
            return {"found": True, "address_id": a["id"], "address": a["label"], "fiber_mbps": a["fiber_mbps"], "five_g": a["five_g"]}
    return {"found": False, "address": inp["address"]}


def port_check(inp, data):
    _allow_only(inp, ["number"])
    number = to_e164(_req_str(inp, "number"))
    if not number:
        raise InvalidInput("number must be a US phone number")
    rec = next((r for r in data["port_numbers"] if r["number"] == number), None)
    if not rec:
        return {"number": number, "eligible": False, "reason": "the number is not active at any carrier"}
    return {"number": number, "eligible": True} if rec["eligible"] else {"number": number, "eligible": False, "reason": rec["reason"]}


def order_create(inp, data):
    _allow_only(inp, ["type", "plan_id", "customer_id", "customer", "address_id", "port_number"])
    plan = next((p for p in data["plans"] if p["id"] == inp.get("plan_id")), None)
    if not plan:
        raise InvalidInput(f"unknown plan_id: {inp.get('plan_id')}")
    if inp.get("type") == "upgrade":
        c = next((c for c in data["customers"] if c["id"] == inp.get("customer_id")), None)
        if not c:
            raise InvalidInput(f"unknown customer_id: {inp.get('customer_id')}")
        cur = next((p for p in data["plans"] if p["id"] == c["plan_id"]), None)
        if cur and cur["category"] != plan["category"]:
            raise InvalidInput("an upgrade keeps the category of the current plan")
        if inp.get("customer") is not None or inp.get("port_number") is not None:
            raise InvalidInput("an upgrade takes customer_id only")
    elif inp.get("type") == "new":
        c = inp.get("customer")
        if not isinstance(c, dict) or not isinstance(c.get("name"), str) or not isinstance(c.get("email"), str):
            raise InvalidInput("a new order needs customer.name and customer.email")
        if plan["category"] == "home":
            addr = next((a for a in data["addresses"] if a["id"] == inp.get("address_id")), None)
            if not addr:
                raise InvalidInput("a home plan needs a known address_id")
            ok = addr["fiber_mbps"] >= plan.get("speed_mbps", 0) if plan.get("access") == "fiber" else addr["five_g"]
            if not ok:
                raise InvalidInput(f"{plan['name']} is not available at {addr['label']}")
            if inp.get("port_number") is not None:
                raise InvalidInput("port_number applies to mobile plans only")
        else:
            if inp.get("address_id") is not None:
                raise InvalidInput("address_id applies to home plans only")
            if inp.get("port_number") is not None:
                num = to_e164(str(inp["port_number"]))
                rec = next((r for r in data["port_numbers"] if r["number"] == num), None)
                if not rec or not rec["eligible"]:
                    raise InvalidInput("port_number cannot move to Acme")
    else:
        raise InvalidInput("type must be new or upgrade")
    return {"order_id": "ORD-" + _short_hash(inp), "status": "pending", "plan_id": plan["id"], "monthly_usd": plan["monthly_usd"]}


def notify_sales(inp, data):
    _allow_only(inp, ["reason", "customer", "summary"])
    if inp.get("reason") not in LEAD_REASONS:
        raise InvalidInput("reason must be callback, no_coverage, tool_failure or order_failed")
    c = inp.get("customer")
    if not isinstance(c, dict) or (not isinstance(c.get("phone"), str) and not isinstance(c.get("email"), str)):
        raise InvalidInput("customer needs a phone or an email")
    _req_str(inp, "summary")
    return {"ticket_id": "LEAD-" + _short_hash(inp), "queued": True}


IMPL = {
    "catalog_search": catalog_search,
    "coverage_check": coverage_check,
    "port_check": port_check,
    "order_create": order_create,
    "notify_sales": notify_sales,
}

TOOL_DEFS = [
    {
        "name": "catalog_search",
        "description": "List Acme plans of a category. With customer_email, also returns that customer and their current plan id (customer is null when no account has that email). With address_id (home only), returns only the home plans available at that address.",
        "input_schema": {"type": "object", "properties": {
            "category": {"type": "string", "enum": ["mobile", "home"]},
            "customer_email": {"type": "string"},
            "address_id": {"type": "string"},
        }, "required": ["category"], "additionalProperties": False},
    },
    {
        "name": "coverage_check",
        "description": "Check whether Acme home internet reaches a street address. Returns found, address_id, address, fiber_mbps (0 = no fiber) and five_g.",
        "input_schema": {"type": "object", "properties": {"address": {"type": "string"}}, "required": ["address"], "additionalProperties": False},
    },
    {
        "name": "port_check",
        "description": "Check whether a phone number held at another carrier can move to Acme. Returns number, eligible and, when not eligible, a reason.",
        "input_schema": {"type": "object", "properties": {"number": {"type": "string"}}, "required": ["number"], "additionalProperties": False},
    },
    {
        "name": "order_create",
        "description": "Place an order. type 'upgrade' takes customer_id and plan_id only. type 'new' takes plan_id and customer {name, email}, plus address_id for a home plan or port_number for a mobile plan that keeps a number.",
        "input_schema": {"type": "object", "properties": {
            "type": {"type": "string", "enum": ["new", "upgrade"]},
            "plan_id": {"type": "string"},
            "customer_id": {"type": "string"},
            "customer": {"type": "object", "properties": {"name": {"type": "string"}, "email": {"type": "string"}}},
            "address_id": {"type": "string"},
            "port_number": {"type": "string"},
        }, "required": ["type", "plan_id"], "additionalProperties": False},
    },
    {
        "name": "notify_sales",
        "description": "Hand a lead to a human sales advisor. reason is one of callback, no_coverage, tool_failure, order_failed. customer holds name, email and/or phone (a phone or an email is required). summary is one or two sentences.",
        "input_schema": {"type": "object", "properties": {
            "reason": {"type": "string", "enum": ["callback", "no_coverage", "tool_failure", "order_failed"]},
            "customer": {"type": "object", "properties": {"name": {"type": "string"}, "email": {"type": "string"}, "phone": {"type": "string"}}},
            "summary": {"type": "string"},
        }, "required": ["reason", "customer", "summary"], "additionalProperties": False},
    },
]


def call_tool(name: str, inp: dict, overrides: dict | None = None):
    """Returns (ok, output_or_error). overrides[name] = {"error": str} or {"result": obj}."""
    ov = (overrides or {}).get(name)
    if ov and "error" in ov:
        return False, ov["error"]
    if ov and "result" in ov:
        return True, ov["result"]
    if name not in IMPL:
        return False, f"unknown tool: {name}"
    try:
        return True, IMPL[name](inp, copy.deepcopy(SEED))
    except InvalidInput as e:
        return False, str(e)
