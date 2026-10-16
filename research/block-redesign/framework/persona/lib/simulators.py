"""Copied from research/block-sim (a460cdffa) lib/simulators.py. Changes for the persona lane, each a no-op
when the persona keys are absent (H10 behaviour unchanged): volunteer_max, words_target, language, lines.
Three simulated users: free prompt, findings prompt, and the agenda engine (M2.1) with an LLM realiser."""
import json, random, re
from . import llm, abcd

STOP_TOKENS = ("###STOP###", "###TRANSFER###", "###OUT-OF-SCOPE###", "###ABANDON###")

# tau-bench tau_bench/envs/user.py build_system_prompt, verbatim (typo "satisified" kept).
TAU_RULES = """Rules:
- Just generate one line at a time to simulate the user's message.
- Do not give away all the instruction at once. Only provide the information that is necessary for the current step.
- Do not hallucinate information that is not provided in the instruction. For example, if the agent asks for the order id but it is not mentioned in the instruction, do not make up an order id, just say you do not remember or have it.
- If the instruction goal is satisified, generate '###STOP###' as a standalone message without anything else to end the conversation.
- Do not repeat the exact instruction in the conversation. Instead, use your own words to convey the same information.
- Try to make the conversation as natural as possible, and stick to the personalities in the instruction."""

# Reconstruction of the Sim2Real App. A.6 findings-informed persona (the paper lists the findings; its exact
# prompt text was not read). Six lines, one per finding.
FINDINGS_RULES = """- Reveal information gradually, one piece at a time, only when the agent asks for it.
- Vary your tone and the length of your messages, as real customers do.
- When you are not sure about something, say so.
- Ask a clarifying question when the agent's message is unclear to you.
- Push back when the agent says something wrong or unhelpful.
- Show frustration when your problem is not getting solved."""


def instruction(conv):
    f = abcd.facts(conv)
    lines = "\n".join(f"- {k.replace('_', ' ')}: {v}" for k, v in f.items())
    return ("You are a customer of an online clothing store, chatting with its customer service. "
            f"{abcd.goal(conv)} What you know about yourself and your order:\n{lines}")


def find_stop(text):
    for t in STOP_TOKENS:
        if t in text:
            return t
    return None


class PromptUser:
    """free (tau-bench rules) or findings (tau-bench rules + findings lines)."""

    def __init__(self, conv, family="O", findings=False, tag="sim"):
        self.family, self.tag = family, tag
        rules = TAU_RULES + ("\n" + FINDINGS_RULES if findings else "")
        self.system = f"You are a user interacting with an agent.\n\nInstruction: {instruction(conv)}\n\n{rules}"
        self.messages = []

    def reply(self, agent_text):
        self.messages.append({"role": "user", "content": agent_text})
        text = llm.chat(self.family, self.system, self.messages, self.tag).strip()
        self.messages.append({"role": "assistant", "content": text})
        stop = find_stop(text)
        clean = text
        for t in STOP_TOKENS:
            clean = clean.replace(t, "")
        return clean.strip(), stop, {}


# ---------------------------------------------------------------- agenda engine (M2.1)

SLOTS = ["customer_name", "account_id", "username", "email", "phone", "zip_code", "order_id", "full_address",
         "payment_method", "purchase_date", "member_level", "items_in_order", "product_concerned",
         "shipping_status", "pin_number", "security_answer", "packaging", "refund_method"]

PARAMS = {  # section 2.2 schema defaults (Sim2Real / Lost in Simulation human rates); none tuned on ABCD
    "acts_per_turn": {1: 0.7, 2: 0.25, 3: 0.05},
    "volunteer_prob": {"order_id": 0.3},
    "short_turn_share": 0.29, "polite_turn_share": 0.15, "uncertainty_turn_share": 0.07,
    "question_turn_share": 0.10, "repeat_after_refusal": 1, "turn_budget": 16,
    "engagement_initial": 0.8, "decay_per_unhelpful_turn": 0.15, "disengage_below": 0.3,
}

CLASSIFIER_SYSTEM = """You label one message written by a customer service agent to a customer. Return JSON only:
{"requested_slots": [...], "asks_problem_detail": bool, "asks_confirmation": bool, "asks_to_try_something": bool,
 "says_cannot_do": bool, "says_resolved": bool, "asks_anything_else": bool}
requested_slots: the customer details the agent asks for in this message, from this list only:
""" + ", ".join(SLOTS) + """, other. Use "other" for any other requested information.
asks_problem_detail: the agent asks what the problem is, the reason, or which item.
asks_confirmation: the agent asks the customer to confirm or choose between options.
asks_to_try_something: the agent asks the customer to try a fix (log out and in, retry, clear cache, ...).
says_cannot_do: the agent refuses or says it cannot do what the customer wants.
says_resolved: the agent says the request is done or answered.
asks_anything_else: the agent asks whether there is anything else it can help with, or says goodbye."""

REALISER_SYSTEM = """You write the next chat message of a customer talking to an online store's customer service.
You are given the customer's situation, the conversation so far, and a plan: the exact dialogue acts this message
must carry and style constraints. Write ONE message that carries exactly the planned acts and nothing else:
do not add information, details or questions that are not in the plan. Use the exact values given for any detail.
Write like a real person typing in a chat window. Output only the message text."""


def classify_agent(text, tag):
    raw = llm.chat("O", CLASSIFIER_SYSTEM, [{"role": "user", "content": text}], tag, json_mode=True)
    try:
        d = json.loads(raw)
    except Exception:
        d = {}
    out = {"requested_slots": [s for s in d.get("requested_slots", []) if s in SLOTS + ["other"]]}
    for k in ("asks_problem_detail", "asks_confirmation", "asks_to_try_something", "says_cannot_do",
              "says_resolved", "asks_anything_else"):
        out[k] = bool(d.get(k, False))
    return out


TURN_SCOPED = {"answer", "dont_know", "answer_other", "confirm", "report_try", "acknowledge", "ask_status"}


class Engine:
    """Deterministic given (seed, classifier outputs). Holds goal, ledger, agenda, engagement, stop rules."""

    def __init__(self, conv, seed, params=PARAMS):
        self.p = params
        self.rng = random.Random(seed)
        self.facts = abcd.facts(conv)
        if "payment_method" in self.facts:
            self.facts.setdefault("refund_method", self.facts["payment_method"])
        self.goal = abcd.goal(conv)
        self.agenda = [{"act": "goodbye"}, {"act": "inform_intent"}]  # stack: top is the end of the list
        self.closure_seen = False
        self.refusals = 0
        self.tries = 0
        self.engagement = params["engagement_initial"]
        self.turn = 0
        self.disclosed = set()
        self.last_requested = None

    def _push(self, acts):
        for a in reversed(acts):
            self.agenda.append(a)

    def observe(self, c):
        """Push rules on the agent's classified turn (Schatzmann 2007 Sec. 2.5)."""
        # clean-up (Schatzmann 2007 Sec. 2.5): responses to an earlier agent turn are stale once the agent
        # has moved on (an "A or B" request leaves the unanswered alternative behind)
        self.agenda = [a for a in self.agenda if a["act"] not in TURN_SCOPED]
        pushes = []
        unhelpful = False
        req = tuple(sorted(c["requested_slots"]))
        if req and req == self.last_requested:
            unhelpful = True
        self.last_requested = req or None
        for s in c["requested_slots"]:
            if s == "other":
                pushes.append({"act": "answer_other"})
            elif s in self.facts:
                pushes.append({"act": "answer", "slot": s})
            else:
                pushes.append({"act": "dont_know", "slot": s})
        if c["asks_problem_detail"]:
            pushes.append({"act": "inform_detail"})
        if c["asks_confirmation"]:
            pushes.append({"act": "confirm"})
        if c["asks_to_try_something"]:
            self.tries += 1
            pushes.append({"act": "report_try", "worked": self.tries >= 2})
        if c["says_cannot_do"]:
            unhelpful = True
            self.refusals += 1
            if self.refusals <= self.p["repeat_after_refusal"]:
                pushes.append({"act": "repeat_request"})
            else:
                pushes.append({"act": "accept_outcome"})
                self.closure_seen = True
        if c["says_resolved"] or c["asks_anything_else"]:
            self.closure_seen = True
        if unhelpful:
            self.engagement -= self.p["decay_per_unhelpful_turn"]
        if not pushes and not self.closure_seen:
            pushes.append({"act": "acknowledge"})
        # clean-up: drop duplicate answers already on the agenda
        seen = {json.dumps(a, sort_keys=True) for a in self.agenda}
        self._push([a for a in pushes if json.dumps(a, sort_keys=True) not in seen])

    def plan(self):
        """Pop n acts; returns (acts, style, stop)."""
        self.turn += 1
        if self.turn > self.p["turn_budget"] or self.engagement < self.p["disengage_below"]:
            return [{"act": "abandon"}], {}, "###ABANDON###"
        r = self.rng.random()
        n, acc = 1, 0.0
        for k, pk in sorted(self.p["acts_per_turn"].items()):
            acc += pk
            if r < acc:
                n = k
                break
        acts = []
        while len(acts) < n and self.agenda:
            top = self.agenda[-1]
            if top["act"] == "goodbye" and not self.closure_seen:
                break  # guard_premature: bye stays at the bottom until the agent signals closure
            acts.append(self.agenda.pop())
            if top["act"] == "goodbye":
                break
        if not acts:
            if self.closure_seen:
                acts = [{"act": "goodbye"}]
            else:
                acts = [{"act": "ask_status"}]
        if acts[0]["act"] == "inform_intent":
            vol, vmax = 0, self.p.get("volunteer_max", len(self.p["volunteer_prob"]))
            for slot, pr in self.p["volunteer_prob"].items():
                if vol >= vmax:
                    break
                if slot in self.facts and self.rng.random() < pr:
                    vol += 1
                    acts.append({"act": "answer", "slot": slot})
                    self.agenda = [a for a in self.agenda if a.get("slot") != slot]
        style = {
            "short": self.rng.random() < self.p["short_turn_share"],
            "polite": self.rng.random() < self.p["polite_turn_share"],
            "uncertain": self.rng.random() < self.p["uncertainty_turn_share"],
            "question": self.rng.random() < self.p["question_turn_share"],
        }
        for a in acts:
            if a["act"] == "answer":
                self.disclosed.add(a["slot"])
        stop = "###STOP###" if any(a["act"] in ("goodbye",) for a in acts) else None
        return acts, style, stop


def describe_acts(acts, engine):
    out = []
    for a in acts:
        k = a["act"]
        if k == "inform_intent":
            out.append(f"state your problem in general terms (no details, no ids): {engine.goal}")
        elif k == "inform_detail":
            pc = engine.facts.get("product_concerned") or engine.facts.get("items_in_order")
            out.append("explain the specific problem" + (f" (the item: {pc})" if pc else "") + f"; situation: {engine.goal}")
        elif k == "answer":
            out.append(f"give your {a['slot'].replace('_', ' ')}: {engine.facts[a['slot']]}")
        elif k == "dont_know":
            out.append(f"say you do not know or do not have your {a['slot'].replace('_', ' ')}")
        elif k == "answer_other":
            out.append("answer the agent's other question briefly from your situation, or say you do not know")
        elif k == "confirm":
            out.append("confirm or choose what the agent proposed, in line with your goal")
        elif k == "report_try":
            out.append("say you tried it and it worked" if a["worked"] else "say you tried it and it still does not work")
        elif k == "repeat_request":
            out.append("push back once: repeat what you want and ask if there is really no way")
        elif k == "accept_outcome":
            out.append("accept the outcome")
        elif k == "acknowledge":
            out.append("acknowledge briefly (for example ok)")
        elif k == "ask_status":
            out.append("ask what happens next with your request")
        elif k == "goodbye":
            out.append("say no, nothing else, and end the chat")
        elif k == "abandon":
            out.append("give up and leave the chat")
    return out


LANGUAGE_NAMES = {"en": "English", "fr": "French"}
# (words for a polite turn, words a non-polite turn avoids); English is the H10 text unchanged
POLITE_WORDS = {"en": ("please, thanks or sorry", "please, thanks, thank you or sorry"),
                "fr": ("s'il vous plaît, merci or pardon", "please, thanks, sorry, s'il vous plaît, merci or pardon")}
UNSURE_EXAMPLE = {"en": "'I think'", "fr": "'je crois'"}


def style_lines(style, p=None):
    p = p or {}
    s = []
    plain = f"About {p['words_target']} words." if p.get("words_target") else "Plain length, like a real chat message."
    s.append("Very short: at most 3 words (if a detail must be given, give only the detail)." if style.get("short")
             else plain)
    lg = p.get("language", "en")
    s.append(f"Include one polite word ({POLITE_WORDS[lg][0]})." if style.get("polite")
             else f"Do not use the words {POLITE_WORDS[lg][1]}.")
    if style.get("uncertain"):
        s.append(f"Sound a little unsure (for example {UNSURE_EXAMPLE[lg]}).")
    if style.get("question"):
        s.append("Phrase the message as a question if the acts allow it.")
    if p.get("language"):
        s.append(f"Write the message in {LANGUAGE_NAMES[p['language']]}.")
    return s


class EngineUser:
    def __init__(self, conv, seed, family="O", tag="engine", params=PARAMS, classifier=None):
        self.engine = Engine(conv, seed, params)
        self.family, self.tag = family, tag
        self.situation = instruction(conv)
        self.transcript = []
        self.classifier = classifier or (lambda text: classify_agent(text, tag + "-cls"))

    def reply(self, agent_text):
        c = self.classifier(agent_text) if self.engine.turn > 0 else {}
        self.transcript.append(("Agent", agent_text))
        if self.engine.turn > 0:
            self.engine.observe(c)
        acts, style, stop = self.engine.plan()
        plan = "\n".join(f"- {d}" for d in describe_acts(acts, self.engine))
        sty = "\n".join(f"- {d}" for d in style_lines(style, self.engine.p))
        convo = "\n".join(f"{who}: {t}" for who, t in self.transcript[-8:])
        about = ("About you (background only, not to be stated unless relevant):\n"
                 + "\n".join(f"- {l}" for l in self.engine.p["lines"]) + "\n\n") if self.engine.p.get("lines") else ""
        prompt = (f"{about}Customer situation:\n{self.situation}\n\nConversation so far:\n{convo}\n\n"
                  f"Planned acts for this message:\n{plan}\n\nStyle:\n{sty}")
        text = llm.chat(self.family, REALISER_SYSTEM, [{"role": "user", "content": prompt}], self.tag).strip()
        for t in STOP_TOKENS:
            text = text.replace(t, "")
        text = text.strip().strip('"')
        self.transcript.append(("Customer", text))
        rec = {"planned_acts": acts, "style": style, "agent_acts": c, "engagement_after": self.engine.engagement,
               "disclosed": sorted(self.engine.disclosed)}
        return text, stop, rec
