"""Persona files to agenda-engine parameters, the cell seed, and the effective-config hash.

Composition follows simuser_model.md 7.4 for the fields the engine draws. ABCD blocks carry their customer
facts as situational knowledge, so the personas here hold no stable knowledge (no slot can collide), and
ABCD scenarios have no prior contacts, so the starting engagement is the persona's initial value."""
import hashlib, json, os

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "personas")
RUN_SEED = 7
# Facts a persona may volunteer in its opening turn, in this order, at most VOLUNTEER_MAX of them.
VOLUNTEER_SLOTS = ["customer_name", "order_id", "account_id", "username", "email"]
VOLUNTEER_MAX = 2


def load(pid):
    return json.load(open(os.path.join(DIR, pid + ".json")))


def words_target(short_share, words_per_turn):
    """Target length of a non-short turn so the mean over all turns is words_per_turn (short turns about 2 words)."""
    return max(4, round((words_per_turn - 2 * short_share) / (1 - short_share)))


def engine_params(persona, prior_failed_contacts=0):
    b = persona["behaviour"]
    v = b["initiative"]["volunteer_default"]
    eng = b["engagement"]
    return {
        "acts_per_turn": {int(k): p for k, p in b["initiative"]["acts_per_turn"].items()},
        "volunteer_prob": {s: v for s in VOLUNTEER_SLOTS},
        "volunteer_max": VOLUNTEER_MAX,
        "short_turn_share": b["verbosity"]["short_turn_share"],
        "words_target": words_target(b["verbosity"]["short_turn_share"], b["verbosity"]["words_per_turn"]),
        "polite_turn_share": b["tone"]["polite_turn_share"],
        "uncertainty_turn_share": b["tone"]["uncertainty_turn_share"],
        "question_turn_share": b["tone"]["question_turn_share"],
        "repeat_after_refusal": b["commitment"]["repeat_after_refusal"],
        "turn_budget": b["patience"]["turn_budget"],
        "engagement_initial": eng["initial"] - prior_failed_contacts * eng["decay_per_unhelpful_turn"],
        "decay_per_unhelpful_turn": eng["decay_per_unhelpful_turn"],
        "disengage_below": eng["disengage_below"],
        "language": persona["language"],
        "lines": persona.get("lines", []),
    }


def cell_seed(block, persona_id, trial, run_seed=RUN_SEED):
    """seed(cell, trial) = hash(run.seed, block id, persona id, trial) (simuser_model.md 2.5)."""
    h = hashlib.sha256(f"{run_seed}|{block}|{persona_id}|{trial}".encode()).hexdigest()
    return int(h[:8], 16)


def config_hash(params):
    return hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()[:12]
