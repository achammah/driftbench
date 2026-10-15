"""Behaviour metrics (H10, pre-registered definitions), Dice, Cramer-von Mises, pass^k, bootstrap."""
import math, random, re
from itertools import combinations

POLITE = re.compile(r"\b(please|pls|thanks|thank|thx|sorry|appreciate)\b", re.I)
UNCERT = re.compile(r"\b(i think|not sure|maybe|i guess|probably|i don'?t know|i don'?t remember|i believe|perhaps|no idea|can'?t remember)\b", re.I)
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
PHONE = re.compile(r"\(?\d{3}\)?[ -.]?\d{3}[ -.]?\d{4}")
TOKEN = re.compile(r"[A-Za-z0-9$]+")


def n_words(t):
    return len(t.split())


def n_ids(t):
    count = 0
    rest = t
    for rx in (EMAIL, PHONE):
        found = rx.findall(rest)
        count += len(found)
        rest = rx.sub(" ", rest)
    count += sum(1 for tok in TOKEN.findall(rest) if len(tok) >= 5 and any(ch.isdigit() for ch in tok))
    return count


def rates(dialogues):
    """dialogues: list of lists of customer-turn strings. Returns the six pre-registered metrics."""
    turns = [t for d in dialogues for t in d]
    nt = max(len(turns), 1)
    front = []
    for d in dialogues:
        tot = sum(n_words(t) for t in d)
        if tot:
            front.append(sum(n_words(t) for t in d[:2]) / tot)
    return {
        "Short%": 100 * sum(n_words(t) <= 3 for t in turns) / nt,
        "Polite%": 100 * sum(bool(POLITE.search(t)) for t in turns) / nt,
        "FrntId%": 100 * sum(front) / max(len(front), 1),
        "IDs/turn": sum(n_ids(t) for t in turns) / nt,
        "Uncert%": 100 * sum(bool(UNCERT.search(t)) for t in turns) / nt,
        "Quest%": 100 * sum("?" in t for t in turns) / nt,
    }


SIX = ["Short%", "Polite%", "FrntId%", "IDs/turn", "Uncert%", "Quest%"]


def secondary(dialogues):
    turns = [t for d in dialogues for t in d]
    return {"turns/dialogue": sum(len(d) for d in dialogues) / max(len(dialogues), 1),
            "words/turn": sum(n_words(t) for t in turns) / max(len(turns), 1)}


def dice(m, h):
    if m + h == 0:
        return 100.0
    return 200 * min(m, h) / (m + h)


def dice_all(sim, hum):
    a, b = rates(sim), rates(hum)
    return {k: dice(a[k], b[k]) for k in SIX}


def cvm(x0, x1):
    """Pietquin and Hastie: D = alpha * sqrt(sum_i (F0(x0_i) - F1(x0_i))^2), alpha = sqrt(12 N0 / (4 N0^2 - 1))."""
    x0, x1 = sorted(x0), sorted(x1)
    n0 = len(x0)
    F = lambda xs, v: sum(1 for x in xs if x <= v) / len(xs)
    alpha = math.sqrt(12 * n0 / (4 * n0 * n0 - 1))
    return alpha * math.sqrt(sum((F(x0, v) - F(x1, v)) ** 2 for v in x0))


def pass_hat_k(n, c, k):
    if n < k:
        return float("nan")
    return math.comb(c, k) / math.comb(n, k)


def pass_hat_k_brute(outcomes, k):
    subs = list(combinations(range(len(outcomes)), k))
    return sum(all(outcomes[i] for i in s) for s in subs) / len(subs)


def bootstrap(fn, groups, B=2000, seed=0):
    """groups: list of lists to resample independently (with replacement). Returns (lo, hi) 95%."""
    rng = random.Random(seed)
    vals = []
    for _ in range(B):
        res = [[g[rng.randrange(len(g))] for _ in g] for g in groups]
        vals.append(fn(*res))
    vals.sort()
    return vals[int(0.025 * B)], vals[int(0.975 * B) - 1]
