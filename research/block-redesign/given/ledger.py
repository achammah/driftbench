"""Sums calls.jsonl into LEDGER rows: per batch (run prefix up to the first ':'), calls, tokens, USD.
Prices: claude-haiku-5-5 0.10/0.50 USD per MTok up to 100K input, 0.50/2.50 above (platform.claude.com/docs/en/about-claude/pricing).
gpt-6-luna 0.10/0.50 USD per MTok (third-party trackers citing OpenAI's page; the page refused our fetch with 403)."""
import json, sys, collections
PRICE = {'claude-haiku-5-5': (0.10, 0.50, 0.50, 2.50, 100_000), 'gpt-6-luna': (0.10, 0.50, 0.20, 0.75, 272_000)}
rows = collections.OrderedDict()
for line in open('calls.jsonl'):
    d = json.loads(line)
    batch = d['run'].split(':')[0]
    i = d['input_tokens'] + d.get('cache_read', 0) + d.get('cache_write', 0); o = d['output_tokens']
    lo_i, lo_o, hi_i, hi_o, th = PRICE[d['model']]
    usd = (i * (hi_i if i > th else lo_i) + o * (hi_o if i > th else lo_o)) / 1e6
    r = rows.setdefault((batch, d['model']), [0, 0, 0, 0.0]); r[0] += 1; r[1] += i; r[2] += o; r[3] += usd
cum = 0.0
for (b, m), (n, i, o, usd) in rows.items():
    cum += usd; print(f'| {b} | {m} | {n} | {i} | {o} | {usd:.4f} | {cum:.4f} |')
