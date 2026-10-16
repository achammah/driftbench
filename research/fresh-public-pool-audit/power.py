"""Exact unconditional paired-sign-test power; scipy 1.x, no model calls."""
import json
from pathlib import Path
import numpy as np
from scipy.stats import binom, binomtest
OUT=Path(__file__).resolve().parent

def table(nmax,d,w,alpha):
 m=np.arange(nmax+1)
 # Exact two-sided test: a positive rejection has W >= isf(alpha/2,m,.5)+1.
 critical=binom.isf(alpha/2,m,.5)+1
 positive=binom.sf(critical-1,m,w)
 def power(n):return float(np.dot(binom.pmf(m[:n+1],n,d),positive[:n+1]))
 return power

results=[]
# Haiku's earlier benchmark-only ledger is an optimistic planning proxy, NOT v7 evidence.
for bench,N,W,L,unit in [('JudgeBench',270,27,11,'pair'),('RubricBench',790,184,76,'pair: sign of difference in number correct over its two presentation orders')]:
 d=(W+L)/N;w=W/(W+L)
 for family in [5,10]:
  alpha=.05/family
  power=table(10000,d,w,alpha)
  n=next(n for n in range(1,10001) if power(n)>=.8)
  results.append(dict(benchmark=bench,unit=unit,priorN=N,priorWins=W,priorLosses=L,discordanceRate=d,conditionalWinProbability=w,meanSignedDifference=(W-L)/N,HolmFamily=family,planningAlpha=alpha,targetPower=.8,requiredPairs=n,attainedPower=power(n),previousNPower=power(n-1),powerAtPriorN=power(N),effectProvenance='Earlier Haiku benchmark-only pair ledger vs promptfoo; not an observed default-v7 or all-peer effect'))
# Verify threshold construction against scipy exact test for every k at small m.
for m in range(1,60):
 c=int(binom.isf(.01/2,m,.5)+1)
 for k in range(m//2+1,m+1):assert (k>=c)==(binomtest(k,m,.5).pvalue<=.01)
(OUT/'power.json').write_text(json.dumps(dict(method='Sum over M~Binomial(N,d) of Pr[exact two-sided binomial p<=alpha and W>M/2 | W~Binomial(M,w)]. Holm first threshold alpha=.05/5; 10-cell joint-family sensitivity also given. Target 80% directional power. Minimum N found by exhaustive integer search.',results=results,limitations=['Peer-specific discordance rates for the frozen new default do not exist on fresh data. These are planning proxies, not a guarantee of power against all peers.','RubricBench games are paired presentations, not independent sample units. The primary calculation clusters them by original pair.','Power does not confer freshness or make a prior TIE retroactively become WIN.']),indent=2)+'\n')
print(json.dumps(results,indent=2))
