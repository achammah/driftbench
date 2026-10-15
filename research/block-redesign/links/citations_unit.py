"""M3.1 check: does Citations' start_char_index count code points or UTF-16 units on non-ASCII text?"""
import json
from pathlib import Path
import anthropic
from registry import u16

DOC = "Café résumé policy \U0001F600\U0001F600. Refunds are allowed within 30 days of delivery. Exchanges take 5 days."
key = (Path.home() / ".nexus-secrets" / "anthropic-driftbench.key").read_text().strip()
c = anthropic.Anthropic(api_key=key)
r = c.messages.create(model="claude-haiku-5-5", max_tokens=400, messages=[{"role": "user", "content": [
    {"type": "document", "source": {"type": "text", "media_type": "text/plain", "data": DOC}, "citations": {"enabled": True}},
    {"type": "text", "text": "How many days do I have for a refund? Cite the sentence."}]}])
out = []
for b in r.content:
    for ct in (getattr(b, "citations", None) or []):
        if ct.type == "char_location":
            q = ct.cited_text
            cp = DOC.find(q.strip())
            out.append({"cited": q, "start_char_index": ct.start_char_index, "end_char_index": ct.end_char_index,
                        "code_point_start": cp, "utf16_start": u16(DOC, cp)})
u = r.usage
print(json.dumps({"citations": out, "usage": {"in": u.input_tokens, "out": u.output_tokens}}, indent=1))
