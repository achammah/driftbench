"""Offline language check for HF11: stopword counts, English against French. Fixed before any HF11 run."""
import re

EN = set("""the and you your is are to of for with can it this that have what would will be my please thank thanks
help here there has was we our if or not do any anything else let know""".split())
FR = set("""le la les et vous votre vos est sont pour avec pouvez je ce cette que qui avez quel quelle sera mon ma mes
merci aide aider ici une des du nous notre si ou pas ne autre chose bonjour puis dans sur""".split())
TOKEN = re.compile(r"[a-zàâäçéèêëîïôöùûüÿœ']+")


def detect(text):
    """'en', 'fr' or None (fewer than 2 stopword hits for the leading language, or a tie)."""
    toks = [t.strip("'") for t in TOKEN.findall(text.lower())]
    toks = [p for t in toks for p in t.split("'") if p]
    en = sum(t in EN for t in toks)
    fr = sum(t in FR for t in toks)
    if en > fr and en >= 2:
        return "en"
    if fr > en and fr >= 2:
        return "fr"
    return None


def check(agent_texts, language):
    """Pass iff at least one agent message has a detected language and every detected one is `language`."""
    found = [d for d in (detect(t) for t in agent_texts) if d]
    return bool(found) and all(d == language for d in found), found
