"""Drive one simulated conversation against an agent and score the gold-button contract."""
import time
from . import abcd

GREETING = "Hi! How can I help you today?"
MAX_USER_TURNS = 20


def run(conv, user, agent):
    turns = [{"role": "agent", "text": GREETING}]
    agent_text, stop, n = GREETING, None, 0
    t0 = time.time()
    while n < MAX_USER_TURNS:
        text, stop, rec = user.reply(agent_text)
        n += 1
        if text:
            turns.append({"role": "user", "text": text, **({"engine": rec} if rec else {})})
        if stop:
            break
        before = len(agent.tool_calls)
        agent_text = agent.respond(text or "...")
        turns.append({"role": "agent", "text": agent_text, "tools": [c[0] for c in agent.tool_calls[before:]]})
    called = {c[0] for c in agent.tool_calls}
    gold = abcd.gold_buttons(conv)
    return {
        "convo_id": conv["convo_id"], "flow": conv["scenario"]["flow"], "subflow": conv["scenario"]["subflow"],
        "turns": turns, "stop": stop or "turn_cap", "user_turns": n,
        "tool_calls": [[c[0], c[1]] for c in agent.tool_calls],
        "gold": gold, "missing": sorted(set(gold) - called), "passed": set(gold) <= called,
        "seconds": round(time.time() - t0, 1),
    }
