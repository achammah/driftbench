"""Copied from research/block-sim (a460cdffa) lib/agent.py; one change: the language rule (HF11).
The agent under test: a support agent built from ABCD's own guidelines, on claude-haiku-5-5.
Tools are the ABCD action buttons; their results are simulated from the scenario, in ABCD's own system
wording, with the outcome a human agent would have read on the dashboard for knowledge-base queries."""
import json, os
from . import llm, abcd

MODEL = "claude-haiku-5-5"
EFFORT = "low"
MAX_TOOL_ROUNDS = 8

BUTTON_TO_TOOL = {
    "Pull up Account": "pull-up-account", "Verify Identity": "verify-identity", "Record Reason": "record-reason",
    "Membership Privileges": "membership", "Membership": "membership", "Update Order": "update-order",
    "Validate Purchase": "validate-purchase", "Ask the Oracle": "ask-the-oracle", "Enter Details": "enter-details",
    "Enter Detail": "enter-details", "Shipping Status": "shipping-status", "Update Account": "update-account",
    "Search FAQ": "search-faq", "Select Answer": "select-faq", "Offer Refund": "offer-refund",
    "Make Purchase": "make-purchase", "Promo Code": "promo-code", "Notify Internal Team": "notify-team",
    "Send Link": "send-link", "Try Again": "try-again", "Log Out/In": "log-out-in",
    "Subscription Status": "subscription-status", "Instructions": "instructions", "Make Password": "make-password",
    "Boots": "search-boots", "Shirt": "search-shirt", "Jeans": "search-jeans", "Jacket": "search-jacket",
    "Pricing": "search-pricing", "Timing": "search-timing", "Policy": "search-policy",
}

FAQ_GUIDE = ("Single-Item Query", "Storewide Query")


def render_guidelines():
    g = json.load(open(os.path.join(abcd.ABCD_DIR, "guidelines.json")))
    lines = []
    for flow, fv in g.items():
        if flow in FAQ_GUIDE:
            continue
        lines.append(f"# Flow: {flow} ({fv['description']})")
        for sub, sv in fv["subflows"].items():
            lines.append(f"## Subflow: {sub}")
            for ins in sv.get("instructions", [])[:1]:
                lines.append(ins)
            for a in sv["actions"]:
                b = a["button"]
                tool = BUTTON_TO_TOOL.get(b)
                head = f"- [{b}] (tool `{tool}`): " if tool else ("- " if b == "N/A" else f"- [{b}]: ")
                lines.append(head + a["text"])
                for s in a.get("subtext", []):
                    lines.append(f"    - {s}")
            for ins in sv.get("instructions", [])[1:]:
                lines.append(ins)
        lines.append("")
    return "\n".join(lines)


SYSTEM_HEAD = """You are a customer service agent for an online clothing store. You chat with one customer at a time.
Follow the store's agent guidelines below exactly. Each [Button] in the guidelines is a tool you can call; the
tool name is given next to it. Call a tool when the guideline says to click its button, with the values the
customer gave you. Ask the customer for the information a step needs before you call its tool. Keep each message
short and conversational, as in a live chat. {language_rule}Never invent customer information. When the issue is resolved,
ask if there is anything else you can help with.

# Store agent guidelines
"""

# The prompt's one global unit for HF11, linked to the persona field `language` (hf11/links.json).
# base: the rule as added for this lane (the ABCD prompt of research/block-sim had no language rule).
LANGUAGE_RULES = {
    "base": "Always reply in the language the customer writes in. ",
    "negate": "Always reply in English, even when the customer writes in another language. ",
    "drop": "",
}


def system_text(rule="base"):
    return SYSTEM_HEAD.replace("{language_rule}", LANGUAGE_RULES[rule]) + render_guidelines()


ONTOLOGY_SLOTS = None


def tool_specs():
    o = json.load(open(os.path.join(abcd.ABCD_DIR, "ontology.json")))
    specs = []
    for group, acts in o["actions"].items():
        for name, slots in acts.items():
            if name == "select-faq":
                slots = ["answer"]
            if name == "verify-identity":
                # the guidelines ask for 3 of: full name, zip code, phone number, email (ontology lists
                # customer_name, account_id, order_id, zip_code); both sets are accepted
                slots = slots + ["phone", "email"]
            props = {s: {"type": "string"} for s in slots}
            specs.append({"name": name, "description": f"ABCD action button `{name}` ({group}).",
                          "input_schema": {"type": "object", "properties": props}})
    specs.sort(key=lambda s: s["name"])
    return specs


def _norm(x):
    return " ".join(str(x).lower().replace("(", "").replace(")", "").replace("-", " ").split())


def simulate_tool(name, args, conv):
    """System text for a button, in ABCD wording; kb queries also return their outcome."""
    f = abcd.facts(conv)
    a = {k: str(v) for k, v in (args or {}).items() if v not in (None, "")}

    def check(keys):
        given = [k for k in keys if k in a]
        bad = [k for k in given if k in f and _norm(a[k]) not in _norm(f[k]) and _norm(f[k]) not in _norm(a[k])]
        return given, bad

    if name == "pull-up-account":
        who = a.get("customer_name") or a.get("account_id") or ""
        return f"Account has been pulled up for {who}."
    if name == "verify-identity":
        given, bad = check(["customer_name", "account_id", "order_id", "zip_code", "phone", "email"])
        res = "Verified." if len(given) >= 3 and not bad else ("Not verified: mismatch on " + ", ".join(bad) if bad else "Not verified: give 3 of the 4 identity items.")
        return "Identity verification in progress ... " + res
    if name == "validate-purchase":
        given, bad = check(["username", "email", "order_id"])
        res = "Purchase is valid." if len(given) >= 3 and not bad else ("Validation failed: mismatch on " + ", ".join(bad) if bad else "Validation failed: username, email and order ID are needed.")
        extra = f" Purchase date on record: {f['purchase_date']}." if "purchase_date" in f and not bad else ""
        return "Purchase validation in progress ... " + res + extra
    if name == "ask-the-oracle":
        return "Querying the system for an answer ... The system confirms the customer's account of the problem."
    if name == "subscription-status":
        amt = conv["scenario"].get("product", {}).get("amounts") or [99]
        return f"Querying the system for subscription status ... Subscription is active; amount due ${amt[0]}; due in 7 days."
    if name == "make-password":
        return "A password has been generated."
    if name == "promo-code":
        return "A promo code has been created."
    if name == "send-link":
        return "A link will be sent."
    if name == "offer-refund":
        return f"A refund has been made for the amount of ${a.get('amount', '')}."
    if name == "make-purchase":
        return f"A purchase of {a.get('product', '')} was made."
    if name == "record-reason":
        v = next(iter(a.values()), "")
        return f"A reason of {v} has been recorded."
    if name == "enter-details":
        v = next(iter(a.values()), "")
        return f"Details of {v} have been entered."
    if name == "shipping-status":
        return f"Shipping status of {a.get('shipping_option', '')} has been noted."
    if name == "update-order":
        v = next(iter(a.values()), "")
        return f"Order has been updated with {v}."
    if name == "update-account":
        v = next(iter(a.values()), "")
        return f"Account has been updated with {v}."
    if name == "notify-team":
        return f"The {a.get('company_team', '')} has been notified."
    if name == "membership":
        lvl = a.get("membership_level") or f.get("member_level", "")
        return f"Membership level of {lvl} has been noted."
    if name in ("try-again", "log-out-in", "instructions"):
        return "Agent is looking for solutions ..."
    if name == "search-faq":
        return "Searching the FAQ pages ..."
    if name.startswith("search-"):
        return f"System action: search {name[7:]}"
    if name == "select-faq":
        return f"FAQ answer {a.get('answer', '')} was selected."
    return "Done."


class Agent:
    """One conversation. history holds Anthropic messages (append-only)."""

    def __init__(self, conv, tag="agent", rule="base"):
        self.conv = conv
        self.tag = tag
        self.rule = rule
        self.system = [{"type": "text", "text": system_text(rule)}]
        self.tools = tool_specs()
        self.history = []
        self.tool_calls = []  # (name, args)

    def respond(self, user_text):
        if self.history and self.history[-1]["role"] == "user":
            # tool round cap hit last turn: the pending tool results and the new text share one user message
            self.history[-1]["content"].append({"type": "text", "text": user_text})
        else:
            self.history.append({"role": "user", "content": user_text})
        text = ""
        for _ in range(MAX_TOOL_ROUNDS + 1):
            r = llm.retry(lambda: llm.anthropic_client().messages.create(
                model=MODEL, max_tokens=2048, system=self.system, tools=self.tools,
                messages=self.history, output_config={"effort": EFFORT},
                cache_control={"type": "ephemeral"}))
            u = r.usage
            llm.record(MODEL, self.tag, inp=u.input_tokens, out=u.output_tokens,
                       cache_read=u.cache_read_input_tokens or 0, cache_write=u.cache_creation_input_tokens or 0)
            self.history.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in r.content]})
            uses = [b for b in r.content if b.type == "tool_use"]
            text = " ".join(b.text for b in r.content if b.type == "text").strip()
            if not uses:
                break
            results = []
            for b in uses:
                self.tool_calls.append((b.name, b.input))
                results.append({"type": "tool_result", "tool_use_id": b.id,
                                "content": simulate_tool(b.name, b.input, self.conv)})
            self.history.append({"role": "user", "content": results})
        return text or "(no reply)"
