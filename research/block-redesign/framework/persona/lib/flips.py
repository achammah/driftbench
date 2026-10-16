"""H11 statistics: per (block, family, batch) pass^4 verdicts, cross-family and within-family flip shares."""
from . import metrics


def verdicts(trials):
    """trials: {block: {family: [bool]*8}}. Returns {block: {(fam, batch): verdict}}."""
    out = {}
    for b, fams in trials.items():
        out[b] = {}
        for f, outs in fams.items():
            for bi, sl in (("A", outs[:4]), ("B", outs[4:8])):
                out[b][(f, bi)] = int(metrics.pass_hat_k(len(sl), sum(sl), 4) == 1.0)
    return out


def flip_shares(trials, fams=("O", "G")):
    v = verdicts(trials)
    blocks = sorted(v)
    f1, f2 = fams
    pairs = [((f1, a), (f2, b)) for a in "AB" for b in "AB"]
    X = sum(sum(v[k][p] != v[k][q] for k in blocks) / len(blocks) for p, q in pairs) / len(pairs)
    W = sum(sum(v[k][(f, "A")] != v[k][(f, "B")] for k in blocks) / len(blocks) for f in fams) / len(fams)
    return X, W


def majority(outs):
    c = sum(outs)
    return "pass" if c >= 3 else ("fail" if c <= 1 else "tie")
