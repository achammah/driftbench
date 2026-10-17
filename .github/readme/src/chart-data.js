// Written by tools/readme-charts.mjs from the result files it names. Do not edit by hand.
window.CHART_DATA = {
  "judge-leads": {
    "kind": "pairs",
    "kicker": "Judge accuracy · held-out cases · Claude Haiku 5.5 on both sides",
    "title": "Cases correct of 72, driftbench against DeepEval's default.",
    "key": [
      "driftbench default-on-v7",
      "the other tool's default"
    ],
    "min": 0,
    "max": 100,
    "ticks": [
      0,
      25,
      50,
      75,
      100
    ],
    "tick": "",
    "axis": "score out of 100: correct verdicts, % of cases",
    "groups": [
      {
        "header": "DeepEval 4.2.8, default metrics",
        "rows": [
          {
            "label": "Turn relevancy",
            "a": 100,
            "b": 50,
            "aText": "72",
            "bText": "36",
            "aCi": [
              94.93,
              100
            ],
            "bCi": [
              38.75,
              61.25
            ],
            "tag": "ahead"
          },
          {
            "label": "Hallucination",
            "a": 100,
            "b": 50,
            "aText": "72",
            "bText": "36",
            "aCi": [
              94.93,
              100
            ],
            "bCi": [
              38.75,
              61.25
            ],
            "tag": "ahead"
          },
          {
            "label": "Faithfulness",
            "a": 100,
            "b": 50,
            "aText": "72",
            "bText": "36",
            "aCi": [
              94.93,
              100
            ],
            "bCi": [
              38.75,
              61.25
            ],
            "tag": "ahead"
          },
          {
            "label": "Completeness",
            "a": 100,
            "b": 63.89,
            "aText": "72",
            "bText": "46",
            "aCi": [
              94.93,
              100
            ],
            "bCi": [
              52.35,
              74.02
            ],
            "tag": "ahead"
          },
          {
            "label": "Role adherence",
            "a": 100,
            "b": 87.5,
            "aText": "72",
            "bText": "63",
            "aCi": [
              94.93,
              100
            ],
            "bCi": [
              77.92,
              93.28
            ],
            "tag": "ahead"
          }
        ]
      }
    ],
    "note": "72 cases per row · lines: 95% interval"
  },
  "judge-cost": {
    "kind": "pairs",
    "kicker": "Judge cost · US dollars per 100 cases · Claude Haiku 5.5",
    "title": "Cost per 100 judged cases.",
    "key": [
      "driftbench default-on-v7",
      "the other tool's default"
    ],
    "min": 0,
    "max": 0.15,
    "ticks": [
      0,
      0.05,
      0.1,
      0.15
    ],
    "tick": "$",
    "axis": "US dollars per 100 judged cases",
    "groups": [
      {
        "header": "",
        "rows": [
          {
            "label": "Inspect, grader panel",
            "a": 0.06476766666666667,
            "b": 0.13815413333333335,
            "aText": "$0.065",
            "bText": "$0.138"
          },
          {
            "label": "Inspect, panel on borderline cases",
            "a": 0.06687183333333335,
            "b": 0.12479490000000004,
            "aText": "$0.067",
            "bText": "$0.125"
          },
          {
            "label": "Langfuse, Correctness template",
            "a": 0.051982500000000015,
            "b": 0.05248416666666667,
            "aText": "$0.052",
            "bText": "$0.052"
          },
          {
            "label": "Inspect, model-graded QA",
            "a": 0.07325433333333335,
            "b": 0.06228716666666667,
            "aText": "$0.073",
            "bText": "$0.062"
          },
          {
            "label": "Inspect, model-graded fact",
            "a": 0.07325433333333335,
            "b": 0.05957716666666667,
            "aText": "$0.073",
            "bText": "$0.060"
          }
        ]
      }
    ],
    "note": "60 to 120 cases per row · v7: Messages API; peers: recorded spend"
  },
  "mm-eval-sealed-test": {
    "kind": "pairs",
    "kicker": "MM-Eval · sealed test set · 1,212 items, scored once",
    "title": "A panel when unsure: 89.49 to 91.54.",
    "key": [
      "first judge, then a panel if unsure",
      "first judge alone"
    ],
    "min": 70,
    "max": 100,
    "ticks": [
      70,
      80,
      90,
      100
    ],
    "tick": "",
    "axis": "accuracy, the benchmark's own score (axis starts at 70)",
    "groups": [
      {
        "header": "",
        "rows": [
          {
            "label": "All five subsets",
            "sub": "1,212 items",
            "a": 91.54,
            "b": 89.49,
            "aText": "91.54",
            "bText": "89.49",
            "tag": "+2.05"
          },
          {
            "label": "Linguistics",
            "sub": "45 items",
            "a": 94.44,
            "b": 90.56,
            "aText": "94.44",
            "bText": "90.56",
            "tag": "+3.89"
          },
          {
            "label": "Safety",
            "sub": "195 items",
            "a": 92.31,
            "b": 89.74,
            "aText": "92.31",
            "bText": "89.74",
            "tag": "+2.56"
          },
          {
            "label": "Chat",
            "sub": "46 items",
            "a": 75,
            "b": 72.83,
            "aText": "75.00",
            "bText": "72.83",
            "tag": "+2.17"
          },
          {
            "label": "Reasoning",
            "sub": "615 items",
            "a": 96.59,
            "b": 95.37,
            "aText": "96.59",
            "bText": "95.37",
            "tag": "+1.22"
          },
          {
            "label": "Language mixing",
            "sub": "311 items",
            "a": 99.36,
            "b": 98.95,
            "aText": "99.36",
            "bText": "98.95",
            "tag": "+0.40"
          }
        ]
      }
    ],
    "note": "1,212 items · gain 2.05 points, 95% interval 1.02 to 3.29"
  },
  "testgen-budget": {
    "kind": "triples",
    "kicker": "Test generation · fictional Acme agent · 13 planted faults · 30 seeds",
    "title": "20 tests find 9 of 13 planted faults.",
    "key": [
      "driftbench selector",
      "pairwise covering",
      "random sampling"
    ],
    "min": 7,
    "max": 10,
    "ticks": [
      7,
      8,
      9,
      10
    ],
    "tick": "",
    "axis": "planted faults caught, of 13 (axis starts at 7)",
    "groups": [
      {
        "label": "20 tests",
        "bars": [
          {
            "series": 0,
            "value": 9,
            "text": "9",
            "ci": null
          },
          {
            "series": 1,
            "value": 8,
            "text": "8",
            "ci": null
          },
          {
            "series": 2,
            "value": 8.37,
            "text": "8.37",
            "ci": [
              8.08,
              8.65
            ]
          }
        ]
      },
      {
        "label": "50 tests",
        "bars": [
          {
            "series": 0,
            "value": 9,
            "text": "9",
            "ci": null
          },
          {
            "series": 1,
            "value": 9,
            "text": "9",
            "ci": null
          },
          {
            "series": 2,
            "value": 8.97,
            "text": "8.97",
            "ci": [
              8.9,
              9.03
            ]
          }
        ]
      },
      {
        "label": "100 tests",
        "bars": [
          {
            "series": 0,
            "value": 9,
            "text": "9",
            "ci": null
          },
          {
            "series": 1,
            "value": 9,
            "text": "9",
            "ci": null
          },
          {
            "series": 2,
            "value": 9,
            "text": "9",
            "ci": null
          }
        ]
      },
      {
        "label": "200 tests",
        "bars": [
          {
            "series": 0,
            "value": 9,
            "text": "9",
            "ci": null
          },
          {
            "series": 1,
            "value": 9,
            "text": "9",
            "ci": null
          },
          {
            "series": 2,
            "value": 9,
            "text": "9",
            "ci": null
          }
        ]
      }
    ],
    "note": "Mean over 30 seeds · lines: 95% interval · no model call"
  },
  "self-tests": {
    "kind": "single",
    "kicker": "Self-tests · cases built by code with a known answer",
    "title": "7,455 planted-truth cases test driftbench itself.",
    "key": [
      "holds a floor in CI",
      "no floor yet"
    ],
    "min": 0,
    "max": 2500,
    "ticks": [
      0,
      1000,
      2000
    ],
    "tick": ",",
    "axis": "planted-truth cases in the suite",
    "rows": [
      {
        "label": "Whole pipeline",
        "value": 2385,
        "text": "2,385",
        "series": 0,
        "sub": "floor: level 11"
      },
      {
        "label": "Test generator",
        "value": 2033,
        "text": "2,033",
        "series": 1,
        "sub": "no floor yet"
      },
      {
        "label": "Code-agent estates",
        "value": 1170,
        "text": "1,170",
        "series": 1,
        "sub": "no floor yet"
      },
      {
        "label": "Statistics",
        "value": 651,
        "text": "651",
        "series": 0,
        "sub": "floor: level 7"
      },
      {
        "label": "Judges",
        "value": 638,
        "text": "638",
        "series": 0,
        "sub": "floor: level 20"
      },
      {
        "label": "Map extraction",
        "value": 578,
        "text": "578",
        "series": 0,
        "sub": "floor: level 8"
      }
    ],
    "note": "Floor: the level CI refuses to go below"
  },
  "capability-matrix": {
    "kind": "stacked",
    "kicker": "Capabilities · 30 rows · 8 tools",
    "title": "All 30. The next best: 12 in full.",
    "key": [
      "in full",
      "in part",
      "not found"
    ],
    "min": 0,
    "max": 30,
    "ticks": [
      0,
      10,
      20,
      30
    ],
    "tick": "",
    "axis": "capabilities, of 30",
    "rows": [
      {
        "label": "driftbench",
        "parts": [
          30,
          0,
          0
        ],
        "ours": true
      },
      {
        "label": "deepeval",
        "parts": [
          12,
          14,
          4
        ]
      },
      {
        "label": "langwatch",
        "parts": [
          12,
          11,
          7
        ]
      },
      {
        "label": "promptfoo",
        "parts": [
          10,
          15,
          5
        ]
      },
      {
        "label": "langfuse",
        "parts": [
          10,
          7,
          13
        ]
      },
      {
        "label": "inspect_ai",
        "parts": [
          9,
          14,
          7
        ]
      },
      {
        "label": "opik",
        "parts": [
          9,
          10,
          11
        ]
      },
      {
        "label": "braintrust",
        "parts": [
          2,
          11,
          17
        ]
      }
    ],
    "note": "Read from each tool's docs and source"
  },
  "bench-judgebench": {
    "kind": "ranked",
    "kicker": "JudgeBench · sealed test · official pair score",
    "title": "JudgeBench: driftbench scores 88.9.",
    "key": [
      {
        "label": "driftbench",
        "style": "ours"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "270 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 88.889,
            "ours": true
          },
          {
            "name": "DeepEval",
            "score": 86.296,
            "pattern": "dots"
          },
          {
            "name": "LangWatch",
            "score": 83.704,
            "pattern": "light"
          },
          {
            "name": "promptfoo",
            "score": 82.963,
            "pattern": "hatch"
          },
          {
            "name": "Inspect",
            "score": 80,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": 74.815,
            "pattern": "lines"
          }
        ]
      }
    ],
    "note": "Claude Haiku 5.5, 270 pairs. Every competitor ran on this model only. A refused item counts as wrong."
  },
  "bench-mm-eval": {
    "kind": "ranked",
    "kicker": "MM-Eval · sealed test · the benchmark's own score",
    "title": "MM-Eval: driftbench scores 88.9.",
    "key": [
      {
        "label": "driftbench",
        "style": "ours"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "591 items",
        "bars": [
          {
            "name": "driftbench",
            "score": 88.863,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 86.45,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": 84.095,
            "pattern": "dots",
            "refused": 3
          },
          {
            "name": "LangWatch",
            "score": 83.869,
            "pattern": "light",
            "refused": 7
          },
          {
            "name": "Inspect",
            "score": 75.356,
            "pattern": "cross",
            "refused": 7
          },
          {
            "name": "Langfuse",
            "score": 73.453,
            "pattern": "lines",
            "refused": 6
          }
        ]
      }
    ],
    "note": "Claude Haiku 5.5, 591 items. Every competitor ran on this model only. A refused item counts as wrong."
  },
  "bench-rubricbench": {
    "kind": "ranked",
    "kicker": "RubricBench · test split · both orders of every pair",
    "title": "RubricBench: driftbench scores 82.7.",
    "key": [
      {
        "label": "driftbench",
        "style": "ours"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "1,580 games",
        "bars": [
          {
            "name": "driftbench",
            "score": 82.658,
            "ours": true
          },
          {
            "name": "DeepEval",
            "score": 77.595,
            "pattern": "dots",
            "refused": 1
          },
          {
            "name": "promptfoo",
            "score": 75.57,
            "pattern": "hatch"
          },
          {
            "name": "LangWatch",
            "score": 74.937,
            "pattern": "light"
          },
          {
            "name": "Inspect",
            "score": 26.582,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": 25.063,
            "pattern": "lines",
            "refused": 1
          }
        ]
      }
    ],
    "note": "Claude Haiku 5.5, 1,580 games. Every competitor ran on this model only. A refused item counts as wrong."
  },
  "bench-verify": {
    "kind": "ranked",
    "kicker": "LongJudgeBench verify · test split · is the final answer correct",
    "title": "Verify: driftbench scores 74.2.",
    "key": [
      {
        "label": "driftbench",
        "style": "ours"
      },
      {
        "label": "promptfoo llm-rubric",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "GEval, threshold 0.5 (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278)",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9)",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "LLM-as-a-Judge Boolean (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "221 items",
        "bars": [
          {
            "name": "Langfuse",
            "score": 75.113,
            "pattern": "lines"
          },
          {
            "name": "driftbench",
            "score": 74.208,
            "ours": true
          },
          {
            "name": "Inspect",
            "score": 73.303,
            "pattern": "cross"
          },
          {
            "name": "LangWatch",
            "score": 73.303,
            "pattern": "light"
          },
          {
            "name": "promptfoo",
            "score": 71.946,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": 58.824,
            "pattern": "dots"
          }
        ]
      }
    ],
    "note": "Claude Haiku 5.5, 221 items. Every competitor ran on this model only. A refused item counts as wrong."
  },
  "bench-writing": {
    "kind": "ranked",
    "kicker": "LongJudgeBench writing preference · test split · both orders",
    "title": "Writing: driftbench scores 67.6.",
    "key": [
      {
        "label": "driftbench",
        "style": "ours"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "346 games",
        "bars": [
          {
            "name": "driftbench",
            "score": 67.63,
            "ours": true
          },
          {
            "name": "DeepEval",
            "score": 58.382,
            "pattern": "dots"
          },
          {
            "name": "promptfoo",
            "score": 56.936,
            "pattern": "hatch"
          },
          {
            "name": "LangWatch",
            "score": 52.601,
            "pattern": "light"
          },
          {
            "name": "Langfuse",
            "score": 14.451,
            "pattern": "lines"
          },
          {
            "name": "Inspect",
            "score": 11.561,
            "pattern": "cross"
          }
        ]
      }
    ],
    "note": "Claude Haiku 5.5, 346 games. Every competitor ran on this model only. A refused item counts as wrong. The driftbench bar uses its opt-in reader-first setting (default 61.3). It scores the same as a rule that always picks the longer reply, 67.6."
  },
  "bench-judgebench-models": {
    "kind": "ranked",
    "kicker": "JudgeBench · sealed test · same items, same model in each panel",
    "title": "JudgeBench: driftbench scores higher with 2, equal with 1 of 3 models.",
    "key": [
      {
        "label": "driftbench pair ledger",
        "style": "ours"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "270 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 88.889,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 82.963,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": 86.296,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": 80,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": 74.815,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": 83.704,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "GPT-6 Luna",
        "model": "270 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 87.037,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 84.815,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "Gemini 3.5 Flash-Lite",
        "model": "270 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 79.63,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 79.63,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      }
    ],
    "note": "Competitors with a recorded result on this benchmark in this repository: promptfoo, DeepEval, Inspect, Langfuse, LangWatch. 270 pairs per model."
  },
  "bench-mm-eval-models": {
    "kind": "ranked",
    "kicker": "MM-Eval · sealed test · the benchmark's own score",
    "title": "MM-Eval: driftbench scores higher with 1, lower with 2 of 3 models.",
    "key": [
      {
        "label": "driftbench pair ledger",
        "style": "ours"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "GPT-6 Luna",
        "model": "600 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 88.083,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 89,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "Claude Haiku 5.5",
        "model": "591 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 88.863,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 86.45,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": 84.095,
            "pattern": "dots",
            "refused": 3
          },
          {
            "name": "Inspect",
            "score": 75.356,
            "pattern": "cross",
            "refused": 7
          },
          {
            "name": "Langfuse",
            "score": 73.453,
            "pattern": "lines",
            "refused": 6
          },
          {
            "name": "LangWatch",
            "score": 83.869,
            "pattern": "light",
            "refused": 7
          }
        ]
      },
      {
        "name": "Gemini 3.5 Flash-Lite",
        "model": "600 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 81.417,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 83.75,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      }
    ],
    "note": "Competitors with a recorded result on this benchmark in this repository: promptfoo, DeepEval, Inspect, Langfuse, LangWatch. Up to 600 pairs per model; Claude Haiku 5.5 scores 591, nine safety items missing."
  },
  "bench-rubricbench-models": {
    "kind": "ranked",
    "kicker": "RubricBench · test split · both orders of every pair",
    "title": "RubricBench: driftbench scores higher with 2, equal with 1 of 3 models.",
    "key": [
      {
        "label": "driftbench pair ledger",
        "style": "ours"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "790 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 82.658,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 75.57,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": 77.595,
            "pattern": "dots",
            "refused": 1
          },
          {
            "name": "Inspect",
            "score": 26.582,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": 25.063,
            "pattern": "lines",
            "refused": 1
          },
          {
            "name": "LangWatch",
            "score": 74.937,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "GPT-6 Luna",
        "model": "790 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 82.278,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 81.519,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "Gemini 3.5 Flash-Lite",
        "model": "790 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 80.759,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 80.823,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      }
    ],
    "note": "Competitors with a recorded result on this benchmark in this repository: promptfoo, DeepEval, Inspect, Langfuse, LangWatch. 790 pairs per model."
  },
  "bench-verify-models": {
    "kind": "ranked",
    "kicker": "LongJudgeBench verify · test split · is the final answer correct",
    "title": "Verify: above promptfoo, below a judge that always says fail.",
    "key": [
      {
        "label": "driftbench verify cascade",
        "style": "ours"
      },
      {
        "label": "no model",
        "style": "baseline"
      },
      {
        "label": "promptfoo llm-rubric",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "GEval, threshold 0.5 (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278)",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9)",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "LLM-as-a-Judge Boolean (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "221 items",
        "bars": [
          {
            "name": "driftbench",
            "score": 74.208,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 71.946,
            "pattern": "hatch"
          },
          {
            "name": "always fail",
            "score": 78.733,
            "baseline": true
          },
          {
            "name": "DeepEval",
            "score": 58.824,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": 73.303,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": 75.113,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": 73.303,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "GPT-6 Luna",
        "model": "221 items",
        "bars": [
          {
            "name": "driftbench",
            "score": 74.661,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 72.398,
            "pattern": "hatch"
          },
          {
            "name": "always fail",
            "score": 78.733,
            "baseline": true
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "Gemini 3.5 Flash-Lite",
        "model": "not run",
        "bars": [
          {
            "name": "driftbench",
            "score": null,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": null,
            "pattern": "hatch"
          },
          {
            "name": "always fail",
            "score": 78.733,
            "baseline": true
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      }
    ],
    "note": "Competitors with a recorded result on this benchmark in this repository: promptfoo, DeepEval, Inspect, Langfuse, LangWatch. Not run for driftbench and promptfoo: Gemini 3.5 Flash-Lite."
  },
  "bench-writing-models": {
    "kind": "ranked",
    "kicker": "LongJudgeBench writing preference · test split · both orders",
    "title": "Writing: driftbench scores higher with 1, lower with 2 of 3 models; picking the longer reply beats both.",
    "key": [
      {
        "label": "driftbench pair ledger",
        "style": "ours"
      },
      {
        "label": "no model",
        "style": "baseline"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "173 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 61.272,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 56.936,
            "pattern": "hatch"
          },
          {
            "name": "longer reply",
            "score": 67.63,
            "baseline": true
          },
          {
            "name": "DeepEval",
            "score": 58.382,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": 11.561,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": 14.451,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": 52.601,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "GPT-6 Luna",
        "model": "173 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 53.757,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 56.936,
            "pattern": "hatch"
          },
          {
            "name": "longer reply",
            "score": 67.63,
            "baseline": true
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "Gemini 3.5 Flash-Lite",
        "model": "173 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 58.96,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 60.405,
            "pattern": "hatch"
          },
          {
            "name": "longer reply",
            "score": 67.63,
            "baseline": true
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      }
    ],
    "note": "Competitors with a recorded result on this benchmark in this repository: promptfoo, DeepEval, Inspect, Langfuse, LangWatch. 173 pairs per model."
  },
  "hard-deepeval": {
    "kind": "columns",
    "kicker": "DeepEval hard cases · held-out · Claude Haiku 5.5 on both sides · bars labelled with cases correct",
    "title": "DeepEval: cases correct of 72 or 480 or 1272.",
    "key": [
      "driftbench",
      "DeepEval default"
    ],
    "min": 0,
    "max": 100,
    "ticks": [
      0,
      25,
      50,
      75,
      100
    ],
    "tick": "%",
    "axis": "score out of 100: correct, % of items",
    "groups": [
      {
        "label": "Turn rel|e|vancy",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 50,
            "text": "36"
          }
        ]
      },
      {
        "label": "Hal|luci|nation",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 50,
            "text": "36"
          }
        ]
      },
      {
        "label": "Faith|ful|ness",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 50,
            "text": "36"
          }
        ]
      },
      {
        "label": "Com|plete|ness",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 63.89,
            "text": "46"
          }
        ]
      },
      {
        "label": "Role ad|her|ence",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 87.5,
            "text": "63"
          }
        ]
      },
      {
        "label": "DAG, one node",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 90.28,
            "text": "65"
          }
        ]
      },
      {
        "label": "G-Eval, strict *",
        "sub": "of 480; ahead",
        "bars": [
          {
            "series": 0,
            "value": 99.79,
            "text": "479"
          },
          {
            "series": 1,
            "value": 93.96,
            "text": "451"
          }
        ]
      },
      {
        "label": "Task com|ple|tion",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 100,
            "text": "72"
          }
        ]
      },
      {
        "label": "Knowl|edge re|ten|tion",
        "sub": "of 1272; level",
        "bars": [
          {
            "series": 0,
            "value": 99.92,
            "text": "1271"
          },
          {
            "series": 1,
            "value": 100,
            "text": "1272"
          }
        ]
      }
    ],
    "note": "Fresh rows: exact paired test, Holm p <= 0.05; other rows: separate 95% intervals · Retention exact p = 1.00 · Knowledge retention: 1 incomplete pairs excluded · cases per test: 72 or 480 or 1272 · * opt-in setting response-relevance (opt-in); every other bar is the shipped judge"
  },
  "hard-promptfoo": {
    "kind": "columns",
    "kicker": "promptfoo hard cases · held-out · Claude Haiku 5.5 on both sides · bars labelled with cases correct",
    "title": "promptfoo: cases correct of 72.",
    "key": [
      "driftbench default-on-v7",
      "promptfoo default"
    ],
    "min": 0,
    "max": 100,
    "ticks": [
      0,
      25,
      50,
      75,
      100
    ],
    "tick": "%",
    "axis": "score out of 100: correct, % of items",
    "groups": [
      {
        "label": "LLM rubric",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 95.83,
            "text": "69"
          }
        ]
      },
      {
        "label": "Factuality",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 97.22,
            "text": "70"
          }
        ]
      },
      {
        "label": "Personal data",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 98.61,
            "text": "71"
          }
        ]
      },
      {
        "label": "Goal success",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 98.61,
            "text": "71"
          }
        ]
      }
    ],
    "note": "Ahead or behind: the 95% intervals do not overlap"
  },
  "hard-inspect": {
    "kind": "columns",
    "kicker": "Inspect hard cases · held-out · Claude Haiku 5.5 on both sides · bars labelled with cases correct",
    "title": "Inspect: cases correct of 60.",
    "key": [
      "driftbench default-on-v7",
      "Inspect default"
    ],
    "min": 0,
    "max": 100,
    "ticks": [
      0,
      25,
      50,
      75,
      100
    ],
    "tick": "%",
    "axis": "score out of 100: correct, % of items",
    "groups": [
      {
        "label": "Model-graded QA",
        "sub": "of 60",
        "bars": [
          {
            "series": 0,
            "value": 96.67,
            "text": "58"
          },
          {
            "series": 1,
            "value": 95,
            "text": "57"
          }
        ]
      },
      {
        "label": "Panel, borderline",
        "sub": "of 60",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "60"
          },
          {
            "series": 1,
            "value": 100,
            "text": "60"
          }
        ]
      },
      {
        "label": "Model-graded fact",
        "sub": "of 60",
        "bars": [
          {
            "series": 0,
            "value": 96.67,
            "text": "58"
          },
          {
            "series": 1,
            "value": 98.33,
            "text": "59"
          }
        ]
      },
      {
        "label": "Grader panel",
        "sub": "of 60",
        "bars": [
          {
            "series": 0,
            "value": 90,
            "text": "54"
          },
          {
            "series": 1,
            "value": 98.33,
            "text": "59"
          }
        ]
      }
    ],
    "note": "Ahead or behind: the 95% intervals do not overlap"
  },
  "hard-langfuse": {
    "kind": "hbars",
    "kicker": "Langfuse hard cases · held-out · Claude Haiku 5.5 on both sides",
    "title": "Langfuse: 119 of 120 correct, against 115.",
    "key": [
      "driftbench default-on-v7",
      "Langfuse default"
    ],
    "min": 0,
    "max": 100,
    "ticks": [
      0,
      25,
      50,
      75,
      100
    ],
    "tick": "",
    "axis": "score out of 100: correct, % of cases",
    "rows": [
      {
        "label": "driftbench",
        "series": 0,
        "value": 99.17,
        "text": "99.2",
        "sub": "119 of 120"
      },
      {
        "label": "Langfuse",
        "series": 1,
        "value": 95.83,
        "text": "95.8",
        "sub": "115 of 120"
      }
    ],
    "note": "Reference correctness · 120 cases"
  },
  "summary": {
    "title": "Judge accuracy on public benchmarks",
    "svg": {
      "light": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"800\" height=\"810\" viewBox=\"0 0 800 810\" role=\"img\" aria-label=\"Judge accuracy on public benchmarks, grouped bars with a split score axis\"><defs><pattern id=\"fill1\" width=\"7\" height=\"7\" patternUnits=\"userSpaceOnUse\"><rect width=\"7\" height=\"7\" fill=\"#E0E1E4\"/><path d=\"M-2,2 L2,-2 M0,7 L7,0 M5,9 L9,5\" stroke=\"#8A8D94\" stroke-width=\"1.1\"/></pattern><pattern id=\"fill2\" width=\"7\" height=\"7\" patternUnits=\"userSpaceOnUse\"><rect width=\"7\" height=\"7\" fill=\"#E0E1E4\"/><circle cx=\"2\" cy=\"2\" r=\".9\" fill=\"#8A8D94\"/><circle cx=\"5.5\" cy=\"5.5\" r=\".9\" fill=\"#8A8D94\"/></pattern><pattern id=\"fill3\" width=\"7\" height=\"7\" patternUnits=\"userSpaceOnUse\"><rect width=\"7\" height=\"7\" fill=\"#E0E1E4\"/><path d=\"M0,0 L7,7 M7,0 L0,7\" stroke=\"#8A8D94\" stroke-width=\".85\"/></pattern><pattern id=\"fill4\" width=\"7\" height=\"7\" patternUnits=\"userSpaceOnUse\"><rect width=\"7\" height=\"7\" fill=\"#E0E1E4\"/><path d=\"M0,2 H7 M0,5.5 H7\" stroke=\"#8A8D94\" stroke-width=\".9\"/></pattern></defs><rect x=\"0\" y=\"0\" width=\"800\" height=\"810\" fill=\"#F6F8FB\" stroke=\"none\" stroke-width=\"0.6\"/><text class=\"\" x=\"32\" y=\"59\" fill=\"#0E1116\" font-family=\"'Libre Caslon Display', Georgia, serif\" font-size=\"38\" font-weight=\"400\" text-anchor=\"start\">Judge accuracy on public benchmarks</text><text class=\"\" x=\"768\" y=\"57\" fill=\"#555B65\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"11\" font-weight=\"400\" text-anchor=\"end\">Scores out of 100</text><rect x=\"32\" y=\"91\" width=\"18\" height=\"16\" fill=\"#2F5FD0\" stroke=\"none\" stroke-width=\"0.6\"/><text class=\"\" x=\"57\" y=\"103\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"600\" text-anchor=\"start\">driftbench</text><rect x=\"156\" y=\"91\" width=\"18\" height=\"16\" fill=\"url(#fill1)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><text class=\"\" x=\"181\" y=\"103\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"400\" text-anchor=\"start\">promptfoo</text><rect x=\"280\" y=\"91\" width=\"18\" height=\"16\" fill=\"url(#fill2)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><text class=\"\" x=\"305\" y=\"103\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"400\" text-anchor=\"start\">DeepEval</text><rect x=\"404\" y=\"91\" width=\"18\" height=\"16\" fill=\"url(#fill3)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><text class=\"\" x=\"429\" y=\"103\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"400\" text-anchor=\"start\">Inspect</text><rect x=\"528\" y=\"91\" width=\"18\" height=\"16\" fill=\"url(#fill4)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><text class=\"\" x=\"553\" y=\"103\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"400\" text-anchor=\"start\">Langfuse</text><rect x=\"652\" y=\"91\" width=\"18\" height=\"16\" fill=\"#C4C6CC\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><text class=\"\" x=\"677\" y=\"103\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"400\" text-anchor=\"start\">LangWatch</text><path d=\"M32,125 L768,125\" fill=\"none\" stroke=\"#D9DDE4\" stroke-width=\"1\"/><text class=\"\" x=\"54\" y=\"150\" fill=\"#555B65\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"400\" text-anchor=\"start\">Score</text><text class=\"\" x=\"768\" y=\"150\" fill=\"#555B65\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"400\" text-anchor=\"end\">Bars ranked within each benchmark</text><path d=\"M54,518 L768,518\" fill=\"none\" stroke=\"#D9DDE4\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"521.7\" fill=\"#555B65\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">0</text><path d=\"M54,464 L768,464\" fill=\"none\" stroke=\"#D9DDE4\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"467.7\" fill=\"#555B65\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">30</text><path d=\"M54,436 L768,436\" fill=\"none\" stroke=\"#D9DDE4\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"439.7\" fill=\"#555B65\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">50</text><path d=\"M54,384 L768,384\" fill=\"none\" stroke=\"#D9DDE4\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"387.7\" fill=\"#555B65\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">60</text><path d=\"M54,332 L768,332\" fill=\"none\" stroke=\"#D9DDE4\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"335.7\" fill=\"#555B65\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">70</text><path d=\"M54,280 L768,280\" fill=\"none\" stroke=\"#D9DDE4\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"283.7\" fill=\"#555B65\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">80</text><path d=\"M54,228 L768,228\" fill=\"none\" stroke=\"#D9DDE4\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"231.7\" fill=\"#555B65\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">90</text><path d=\"M54,176 L768,176\" fill=\"none\" stroke=\"#D9DDE4\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"179.7\" fill=\"#555B65\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">100</text><path d=\"M49,449 L57,443\" fill=\"none\" stroke=\"#555B65\" stroke-width=\"1.2\"/><path d=\"M49,455 L57,449\" fill=\"none\" stroke=\"#555B65\" stroke-width=\"1.2\"/><rect x=\"59\" y=\"464\" width=\"17\" height=\"54\" fill=\"#2F5FD0\" stroke=\"none\" stroke-width=\"0.6\"/><rect x=\"59\" y=\"233.77720000000002\" width=\"17\" height=\"202.22279999999998\" fill=\"#2F5FD0\" stroke=\"none\" stroke-width=\"0.6\"/><path d=\"M59,440 l17,-5 M59,460 l17,-5\" stroke=\"#2F5FD0\" stroke-width=\"1.1\"/><text class=\"score\" x=\"67.5\" y=\"224.77720000000002\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"600\" text-anchor=\"middle\">88.9</text><rect x=\"82\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill2)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"82\" y=\"247.26079999999996\" width=\"17\" height=\"188.73920000000004\" fill=\"url(#fill2)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M82,440 l17,-5 M82,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><path d=\"M90.5,208.26079999999996 L90.5,244.26079999999996\" fill=\"none\" stroke=\"#555B65\" stroke-width=\"0.65\"/><text class=\"score\" x=\"90.5\" y=\"204.26079999999996\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">86.3</text><rect x=\"105\" y=\"464\" width=\"17\" height=\"54\" fill=\"#C4C6CC\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"105\" y=\"260.73920000000004\" width=\"17\" height=\"175.26079999999996\" fill=\"#C4C6CC\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M105,440 l17,-5 M105,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><text class=\"score\" x=\"113.5\" y=\"251.73920000000004\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">83.7</text><rect x=\"128\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill1)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"128\" y=\"264.5924\" width=\"17\" height=\"171.4076\" fill=\"url(#fill1)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M128,440 l17,-5 M128,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><path d=\"M136.5,225.5924 L136.5,261.5924\" fill=\"none\" stroke=\"#555B65\" stroke-width=\"0.65\"/><text class=\"score\" x=\"136.5\" y=\"221.5924\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">83.0</text><rect x=\"151\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill3)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"151\" y=\"280\" width=\"17\" height=\"156\" fill=\"url(#fill3)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M151,440 l17,-5 M151,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><text class=\"score\" x=\"159.5\" y=\"271\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">80.0</text><rect x=\"174\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill4)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"174\" y=\"306.962\" width=\"17\" height=\"129.038\" fill=\"url(#fill4)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M174,440 l17,-5 M174,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><text class=\"score\" x=\"182.5\" y=\"297.962\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">74.8</text><text class=\"\" x=\"125\" y=\"546\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"14\" font-weight=\"500\" text-anchor=\"middle\">JudgeBench</text><rect x=\"202\" y=\"464\" width=\"17\" height=\"54\" fill=\"#2F5FD0\" stroke=\"none\" stroke-width=\"0.6\"/><rect x=\"202\" y=\"233.9124\" width=\"17\" height=\"202.0876\" fill=\"#2F5FD0\" stroke=\"none\" stroke-width=\"0.6\"/><path d=\"M202,440 l17,-5 M202,460 l17,-5\" stroke=\"#2F5FD0\" stroke-width=\"1.1\"/><text class=\"score\" x=\"210.5\" y=\"224.9124\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"600\" text-anchor=\"middle\">88.9</text><rect x=\"225\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill1)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"225\" y=\"246.45999999999998\" width=\"17\" height=\"189.54000000000002\" fill=\"url(#fill1)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M225,440 l17,-5 M225,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><path d=\"M233.5,207.45999999999998 L233.5,243.45999999999998\" fill=\"none\" stroke=\"#555B65\" stroke-width=\"0.65\"/><text class=\"score\" x=\"233.5\" y=\"203.45999999999998\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">86.5</text><rect x=\"248\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill2)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"248\" y=\"258.706\" width=\"17\" height=\"177.29399999999998\" fill=\"url(#fill2)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M248,440 l17,-5 M248,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><text class=\"score\" x=\"256.5\" y=\"249.70600000000002\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">84.1</text><rect x=\"271\" y=\"464\" width=\"17\" height=\"54\" fill=\"#C4C6CC\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"271\" y=\"259.88120000000004\" width=\"17\" height=\"176.11879999999996\" fill=\"#C4C6CC\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M271,440 l17,-5 M271,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><path d=\"M279.5,220.88120000000004 L279.5,256.88120000000004\" fill=\"none\" stroke=\"#555B65\" stroke-width=\"0.65\"/><text class=\"score\" x=\"279.5\" y=\"216.88120000000004\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">83.9</text><rect x=\"294\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill3)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"294\" y=\"304.14880000000005\" width=\"17\" height=\"131.85119999999995\" fill=\"url(#fill3)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M294,440 l17,-5 M294,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><text class=\"score\" x=\"302.5\" y=\"295.14880000000005\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">75.4</text><rect x=\"317\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill4)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"317\" y=\"314.0444\" width=\"17\" height=\"121.9556\" fill=\"url(#fill4)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M317,440 l17,-5 M317,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><path d=\"M325.5,275.0444 L325.5,311.0444\" fill=\"none\" stroke=\"#555B65\" stroke-width=\"0.65\"/><text class=\"score\" x=\"325.5\" y=\"271.0444\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">73.5</text><text class=\"\" x=\"268\" y=\"546\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"14\" font-weight=\"500\" text-anchor=\"middle\">MM-Eval</text><rect x=\"345\" y=\"464\" width=\"17\" height=\"54\" fill=\"#2F5FD0\" stroke=\"none\" stroke-width=\"0.6\"/><rect x=\"345\" y=\"266.1784\" width=\"17\" height=\"169.8216\" fill=\"#2F5FD0\" stroke=\"none\" stroke-width=\"0.6\"/><path d=\"M345,440 l17,-5 M345,460 l17,-5\" stroke=\"#2F5FD0\" stroke-width=\"1.1\"/><text class=\"score\" x=\"353.5\" y=\"257.1784\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"600\" text-anchor=\"middle\">82.7</text><rect x=\"368\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill2)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"368\" y=\"292.506\" width=\"17\" height=\"143.49400000000003\" fill=\"url(#fill2)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M368,440 l17,-5 M368,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><text class=\"score\" x=\"376.5\" y=\"283.506\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">77.6</text><rect x=\"391\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill1)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"391\" y=\"303.03600000000006\" width=\"17\" height=\"132.96399999999994\" fill=\"url(#fill1)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M391,440 l17,-5 M391,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><path d=\"M399.5,264.03600000000006 L399.5,300.03600000000006\" fill=\"none\" stroke=\"#555B65\" stroke-width=\"0.65\"/><text class=\"score\" x=\"399.5\" y=\"260.03600000000006\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">75.6</text><rect x=\"414\" y=\"464\" width=\"17\" height=\"54\" fill=\"#C4C6CC\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"414\" y=\"306.3276\" width=\"17\" height=\"129.67239999999998\" fill=\"#C4C6CC\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M414,440 l17,-5 M414,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><text class=\"score\" x=\"422.5\" y=\"297.3276\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">74.9</text><rect x=\"437\" y=\"470.1524\" width=\"17\" height=\"47.8476\" fill=\"url(#fill3)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><text class=\"score\" x=\"445.5\" y=\"461.1524\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">26.6</text><rect x=\"460\" y=\"472.8866\" width=\"17\" height=\"45.11340000000001\" fill=\"url(#fill4)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M468.5,433.8866 L468.5,469.8866\" fill=\"none\" stroke=\"#555B65\" stroke-width=\"0.65\"/><text class=\"score\" x=\"468.5\" y=\"429.8866\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">25.1</text><text class=\"\" x=\"411\" y=\"546\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"14\" font-weight=\"500\" text-anchor=\"middle\">RubricBench</text><rect x=\"488\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill4)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"488\" y=\"305.4124\" width=\"17\" height=\"130.5876\" fill=\"url(#fill4)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M488,440 l17,-5 M488,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><text class=\"score\" x=\"496.5\" y=\"296.4124\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">75.1</text><rect x=\"511\" y=\"464\" width=\"17\" height=\"54\" fill=\"#2F5FD0\" stroke=\"none\" stroke-width=\"0.6\"/><rect x=\"511\" y=\"310.1184\" width=\"17\" height=\"125.88159999999999\" fill=\"#2F5FD0\" stroke=\"none\" stroke-width=\"0.6\"/><path d=\"M511,440 l17,-5 M511,460 l17,-5\" stroke=\"#2F5FD0\" stroke-width=\"1.1\"/><path d=\"M519.5,271.1184 L519.5,307.1184\" fill=\"none\" stroke=\"#555B65\" stroke-width=\"0.65\"/><text class=\"score\" x=\"519.5\" y=\"267.1184\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"600\" text-anchor=\"middle\">74.2</text><rect x=\"534\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill3)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"534\" y=\"314.8244\" width=\"17\" height=\"121.17559999999997\" fill=\"url(#fill3)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M534,440 l17,-5 M534,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><text class=\"score\" x=\"542.5\" y=\"305.8244\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">73.3</text><rect x=\"557\" y=\"464\" width=\"17\" height=\"54\" fill=\"#C4C6CC\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"557\" y=\"314.8244\" width=\"17\" height=\"121.17559999999997\" fill=\"#C4C6CC\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M557,440 l17,-5 M557,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><path d=\"M565.5,292.8244 L565.5,311.8244\" fill=\"none\" stroke=\"#555B65\" stroke-width=\"0.65\"/><text class=\"score\" x=\"565.5\" y=\"288.8244\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">73.3</text><rect x=\"580\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill1)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"580\" y=\"321.8808\" width=\"17\" height=\"114.11919999999998\" fill=\"url(#fill1)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M580,440 l17,-5 M580,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><text class=\"score\" x=\"588.5\" y=\"312.8808\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">71.9</text><rect x=\"603\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill2)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"603\" y=\"390.1152\" width=\"17\" height=\"45.884799999999984\" fill=\"url(#fill2)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M603,440 l17,-5 M603,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><text class=\"score\" x=\"611.5\" y=\"381.1152\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">58.8</text><text class=\"\" x=\"554\" y=\"546\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"14\" font-weight=\"500\" text-anchor=\"middle\">verify</text><rect x=\"631\" y=\"464\" width=\"17\" height=\"54\" fill=\"#2F5FD0\" stroke=\"none\" stroke-width=\"0.6\"/><rect x=\"631\" y=\"344.324\" width=\"17\" height=\"91.67599999999999\" fill=\"#2F5FD0\" stroke=\"none\" stroke-width=\"0.6\"/><path d=\"M631,440 l17,-5 M631,460 l17,-5\" stroke=\"#2F5FD0\" stroke-width=\"1.1\"/><text class=\"score\" x=\"639.5\" y=\"335.324\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"600\" text-anchor=\"middle\">67.6</text><rect x=\"654\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill2)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"654\" y=\"392.41360000000003\" width=\"17\" height=\"43.58639999999997\" fill=\"url(#fill2)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M654,440 l17,-5 M654,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><text class=\"score\" x=\"662.5\" y=\"383.41360000000003\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">58.4</text><rect x=\"677\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill1)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"677\" y=\"399.9328\" width=\"17\" height=\"36.067200000000014\" fill=\"url(#fill1)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M677,440 l17,-5 M677,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><path d=\"M685.5,360.9328 L685.5,396.9328\" fill=\"none\" stroke=\"#555B65\" stroke-width=\"0.65\"/><text class=\"score\" x=\"685.5\" y=\"356.9328\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">56.9</text><rect x=\"700\" y=\"464\" width=\"17\" height=\"54\" fill=\"#C4C6CC\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><rect x=\"700\" y=\"422.4748\" width=\"17\" height=\"13.525199999999984\" fill=\"#C4C6CC\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M700,440 l17,-5 M700,460 l17,-5\" stroke=\"#9C9FA6\" stroke-width=\"1.1\"/><text class=\"score\" x=\"708.5\" y=\"413.4748\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">52.6</text><rect x=\"723\" y=\"491.9882\" width=\"17\" height=\"26.011799999999994\" fill=\"url(#fill4)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><text class=\"score\" x=\"731.5\" y=\"482.9882\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">14.5</text><rect x=\"746\" y=\"497.1902\" width=\"17\" height=\"20.809799999999996\" fill=\"url(#fill3)\" stroke=\"#9C9FA6\" stroke-width=\"0.6\"/><path d=\"M754.5,458.1902 L754.5,494.1902\" fill=\"none\" stroke=\"#555B65\" stroke-width=\"0.65\"/><text class=\"score\" x=\"754.5\" y=\"454.1902\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">11.6</text><text class=\"\" x=\"697\" y=\"546\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"14\" font-weight=\"500\" text-anchor=\"middle\">writing</text><text class=\"\" x=\"54\" y=\"568\" fill=\"#555B65\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"start\">Axis break: 30 to 50 omitted. The lower section uses a compressed scale.</text><path d=\"M32,586 L768,586\" fill=\"none\" stroke=\"#D9DDE4\" stroke-width=\"1\"/><text class=\"\" x=\"32\" y=\"610\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"12\" font-weight=\"600\" text-anchor=\"start\">JudgeBench</text><text class=\"\" x=\"149\" y=\"610\" fill=\"#555B65\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11.4\" font-weight=\"400\" text-anchor=\"start\">Correct choices between a right answer and a wrong answer.</text><text class=\"\" x=\"768\" y=\"610\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"end\">270 pairs</text><text class=\"\" x=\"32\" y=\"637\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"12\" font-weight=\"600\" text-anchor=\"start\">MM-Eval</text><text class=\"\" x=\"149\" y=\"637\" fill=\"#555B65\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11.4\" font-weight=\"400\" text-anchor=\"start\">Judgement across chat, reasoning, safety and language tasks.</text><text class=\"\" x=\"768\" y=\"637\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"end\">591 items</text><text class=\"\" x=\"32\" y=\"664\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"12\" font-weight=\"600\" text-anchor=\"start\">RubricBench</text><text class=\"\" x=\"149\" y=\"664\" fill=\"#555B65\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11.4\" font-weight=\"400\" text-anchor=\"start\">Choices between replies against the stated grading criteria.</text><text class=\"\" x=\"768\" y=\"664\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"end\">1,580 games</text><text class=\"\" x=\"32\" y=\"691\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"12\" font-weight=\"600\" text-anchor=\"start\">verify</text><text class=\"\" x=\"149\" y=\"691\" fill=\"#555B65\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11.4\" font-weight=\"400\" text-anchor=\"start\">LongJudgeBench: checks whether the final answer is correct.</text><text class=\"\" x=\"768\" y=\"691\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"end\">221 items</text><text class=\"\" x=\"32\" y=\"718\" fill=\"#0E1116\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"12\" font-weight=\"600\" text-anchor=\"start\">writing</text><text class=\"\" x=\"149\" y=\"718\" fill=\"#555B65\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11.4\" font-weight=\"400\" text-anchor=\"start\">LongJudgeBench: choice of the preferred written reply.</text><text class=\"\" x=\"768\" y=\"718\" fill=\"#0E1116\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"end\">346 games</text><text class=\"\" x=\"149\" y=\"739\" fill=\"#555B65\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11.4\" font-weight=\"400\" text-anchor=\"start\">Reader-first setting: 67.6 shown; default 61.3.</text><text class=\"\" x=\"149\" y=\"756\" fill=\"#555B65\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11.4\" font-weight=\"400\" text-anchor=\"start\">Same score as a rule that always picks the longer reply (67.6).</text><path d=\"M32,773 L768,773\" fill=\"none\" stroke=\"#D9DDE4\" stroke-width=\"1\"/><text class=\"\" x=\"32\" y=\"794\" fill=\"#555B65\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"start\">Source: docs/comparison/benchmarks/*-all-peers.json. Claude Haiku 5.5.</text></svg>",
      "dark": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"800\" height=\"810\" viewBox=\"0 0 800 810\" role=\"img\" aria-label=\"Judge accuracy on public benchmarks, grouped bars with a split score axis\"><defs><pattern id=\"fill1\" width=\"7\" height=\"7\" patternUnits=\"userSpaceOnUse\"><rect width=\"7\" height=\"7\" fill=\"#404247\"/><path d=\"M-2,2 L2,-2 M0,7 L7,0 M5,9 L9,5\" stroke=\"#96999F\" stroke-width=\"1.1\"/></pattern><pattern id=\"fill2\" width=\"7\" height=\"7\" patternUnits=\"userSpaceOnUse\"><rect width=\"7\" height=\"7\" fill=\"#404247\"/><circle cx=\"2\" cy=\"2\" r=\".9\" fill=\"#96999F\"/><circle cx=\"5.5\" cy=\"5.5\" r=\".9\" fill=\"#96999F\"/></pattern><pattern id=\"fill3\" width=\"7\" height=\"7\" patternUnits=\"userSpaceOnUse\"><rect width=\"7\" height=\"7\" fill=\"#404247\"/><path d=\"M0,0 L7,7 M7,0 L0,7\" stroke=\"#96999F\" stroke-width=\".85\"/></pattern><pattern id=\"fill4\" width=\"7\" height=\"7\" patternUnits=\"userSpaceOnUse\"><rect width=\"7\" height=\"7\" fill=\"#404247\"/><path d=\"M0,2 H7 M0,5.5 H7\" stroke=\"#96999F\" stroke-width=\".9\"/></pattern></defs><rect x=\"0\" y=\"0\" width=\"800\" height=\"810\" fill=\"#0B0B0C\" stroke=\"none\" stroke-width=\"0.6\"/><text class=\"\" x=\"32\" y=\"59\" fill=\"#F5F3F0\" font-family=\"'Libre Caslon Display', Georgia, serif\" font-size=\"38\" font-weight=\"400\" text-anchor=\"start\">Judge accuracy on public benchmarks</text><text class=\"\" x=\"768\" y=\"57\" fill=\"#B4B5BA\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"11\" font-weight=\"400\" text-anchor=\"end\">Scores out of 100</text><rect x=\"32\" y=\"91\" width=\"18\" height=\"16\" fill=\"#9DBDF2\" stroke=\"none\" stroke-width=\"0.6\"/><text class=\"\" x=\"57\" y=\"103\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"600\" text-anchor=\"start\">driftbench</text><rect x=\"156\" y=\"91\" width=\"18\" height=\"16\" fill=\"url(#fill1)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><text class=\"\" x=\"181\" y=\"103\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"400\" text-anchor=\"start\">promptfoo</text><rect x=\"280\" y=\"91\" width=\"18\" height=\"16\" fill=\"url(#fill2)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><text class=\"\" x=\"305\" y=\"103\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"400\" text-anchor=\"start\">DeepEval</text><rect x=\"404\" y=\"91\" width=\"18\" height=\"16\" fill=\"url(#fill3)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><text class=\"\" x=\"429\" y=\"103\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"400\" text-anchor=\"start\">Inspect</text><rect x=\"528\" y=\"91\" width=\"18\" height=\"16\" fill=\"url(#fill4)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><text class=\"\" x=\"553\" y=\"103\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"400\" text-anchor=\"start\">Langfuse</text><rect x=\"652\" y=\"91\" width=\"18\" height=\"16\" fill=\"#B1B3B8\" stroke=\"#92959B\" stroke-width=\"0.6\"/><text class=\"\" x=\"677\" y=\"103\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"400\" text-anchor=\"start\">LangWatch</text><path d=\"M32,125 L768,125\" fill=\"none\" stroke=\"#303136\" stroke-width=\"1\"/><text class=\"\" x=\"54\" y=\"150\" fill=\"#B4B5BA\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"400\" text-anchor=\"start\">Score</text><text class=\"\" x=\"768\" y=\"150\" fill=\"#B4B5BA\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" font-weight=\"400\" text-anchor=\"end\">Bars ranked within each benchmark</text><path d=\"M54,518 L768,518\" fill=\"none\" stroke=\"#303136\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"521.7\" fill=\"#B4B5BA\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">0</text><path d=\"M54,464 L768,464\" fill=\"none\" stroke=\"#303136\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"467.7\" fill=\"#B4B5BA\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">30</text><path d=\"M54,436 L768,436\" fill=\"none\" stroke=\"#303136\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"439.7\" fill=\"#B4B5BA\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">50</text><path d=\"M54,384 L768,384\" fill=\"none\" stroke=\"#303136\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"387.7\" fill=\"#B4B5BA\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">60</text><path d=\"M54,332 L768,332\" fill=\"none\" stroke=\"#303136\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"335.7\" fill=\"#B4B5BA\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">70</text><path d=\"M54,280 L768,280\" fill=\"none\" stroke=\"#303136\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"283.7\" fill=\"#B4B5BA\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">80</text><path d=\"M54,228 L768,228\" fill=\"none\" stroke=\"#303136\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"231.7\" fill=\"#B4B5BA\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">90</text><path d=\"M54,176 L768,176\" fill=\"none\" stroke=\"#303136\" stroke-width=\"1\"/><text class=\"\" x=\"43\" y=\"179.7\" fill=\"#B4B5BA\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"end\">100</text><path d=\"M49,449 L57,443\" fill=\"none\" stroke=\"#B4B5BA\" stroke-width=\"1.2\"/><path d=\"M49,455 L57,449\" fill=\"none\" stroke=\"#B4B5BA\" stroke-width=\"1.2\"/><rect x=\"59\" y=\"464\" width=\"17\" height=\"54\" fill=\"#9DBDF2\" stroke=\"none\" stroke-width=\"0.6\"/><rect x=\"59\" y=\"233.77720000000002\" width=\"17\" height=\"202.22279999999998\" fill=\"#9DBDF2\" stroke=\"none\" stroke-width=\"0.6\"/><path d=\"M59,440 l17,-5 M59,460 l17,-5\" stroke=\"#9DBDF2\" stroke-width=\"1.1\"/><text class=\"score\" x=\"67.5\" y=\"224.77720000000002\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"600\" text-anchor=\"middle\">88.9</text><rect x=\"82\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill2)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"82\" y=\"247.26079999999996\" width=\"17\" height=\"188.73920000000004\" fill=\"url(#fill2)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M82,440 l17,-5 M82,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><path d=\"M90.5,208.26079999999996 L90.5,244.26079999999996\" fill=\"none\" stroke=\"#B4B5BA\" stroke-width=\"0.65\"/><text class=\"score\" x=\"90.5\" y=\"204.26079999999996\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">86.3</text><rect x=\"105\" y=\"464\" width=\"17\" height=\"54\" fill=\"#B1B3B8\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"105\" y=\"260.73920000000004\" width=\"17\" height=\"175.26079999999996\" fill=\"#B1B3B8\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M105,440 l17,-5 M105,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><text class=\"score\" x=\"113.5\" y=\"251.73920000000004\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">83.7</text><rect x=\"128\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill1)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"128\" y=\"264.5924\" width=\"17\" height=\"171.4076\" fill=\"url(#fill1)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M128,440 l17,-5 M128,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><path d=\"M136.5,225.5924 L136.5,261.5924\" fill=\"none\" stroke=\"#B4B5BA\" stroke-width=\"0.65\"/><text class=\"score\" x=\"136.5\" y=\"221.5924\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">83.0</text><rect x=\"151\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill3)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"151\" y=\"280\" width=\"17\" height=\"156\" fill=\"url(#fill3)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M151,440 l17,-5 M151,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><text class=\"score\" x=\"159.5\" y=\"271\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">80.0</text><rect x=\"174\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill4)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"174\" y=\"306.962\" width=\"17\" height=\"129.038\" fill=\"url(#fill4)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M174,440 l17,-5 M174,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><text class=\"score\" x=\"182.5\" y=\"297.962\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">74.8</text><text class=\"\" x=\"125\" y=\"546\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"14\" font-weight=\"500\" text-anchor=\"middle\">JudgeBench</text><rect x=\"202\" y=\"464\" width=\"17\" height=\"54\" fill=\"#9DBDF2\" stroke=\"none\" stroke-width=\"0.6\"/><rect x=\"202\" y=\"233.9124\" width=\"17\" height=\"202.0876\" fill=\"#9DBDF2\" stroke=\"none\" stroke-width=\"0.6\"/><path d=\"M202,440 l17,-5 M202,460 l17,-5\" stroke=\"#9DBDF2\" stroke-width=\"1.1\"/><text class=\"score\" x=\"210.5\" y=\"224.9124\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"600\" text-anchor=\"middle\">88.9</text><rect x=\"225\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill1)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"225\" y=\"246.45999999999998\" width=\"17\" height=\"189.54000000000002\" fill=\"url(#fill1)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M225,440 l17,-5 M225,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><path d=\"M233.5,207.45999999999998 L233.5,243.45999999999998\" fill=\"none\" stroke=\"#B4B5BA\" stroke-width=\"0.65\"/><text class=\"score\" x=\"233.5\" y=\"203.45999999999998\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">86.5</text><rect x=\"248\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill2)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"248\" y=\"258.706\" width=\"17\" height=\"177.29399999999998\" fill=\"url(#fill2)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M248,440 l17,-5 M248,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><text class=\"score\" x=\"256.5\" y=\"249.70600000000002\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">84.1</text><rect x=\"271\" y=\"464\" width=\"17\" height=\"54\" fill=\"#B1B3B8\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"271\" y=\"259.88120000000004\" width=\"17\" height=\"176.11879999999996\" fill=\"#B1B3B8\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M271,440 l17,-5 M271,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><path d=\"M279.5,220.88120000000004 L279.5,256.88120000000004\" fill=\"none\" stroke=\"#B4B5BA\" stroke-width=\"0.65\"/><text class=\"score\" x=\"279.5\" y=\"216.88120000000004\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">83.9</text><rect x=\"294\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill3)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"294\" y=\"304.14880000000005\" width=\"17\" height=\"131.85119999999995\" fill=\"url(#fill3)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M294,440 l17,-5 M294,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><text class=\"score\" x=\"302.5\" y=\"295.14880000000005\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">75.4</text><rect x=\"317\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill4)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"317\" y=\"314.0444\" width=\"17\" height=\"121.9556\" fill=\"url(#fill4)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M317,440 l17,-5 M317,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><path d=\"M325.5,275.0444 L325.5,311.0444\" fill=\"none\" stroke=\"#B4B5BA\" stroke-width=\"0.65\"/><text class=\"score\" x=\"325.5\" y=\"271.0444\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">73.5</text><text class=\"\" x=\"268\" y=\"546\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"14\" font-weight=\"500\" text-anchor=\"middle\">MM-Eval</text><rect x=\"345\" y=\"464\" width=\"17\" height=\"54\" fill=\"#9DBDF2\" stroke=\"none\" stroke-width=\"0.6\"/><rect x=\"345\" y=\"266.1784\" width=\"17\" height=\"169.8216\" fill=\"#9DBDF2\" stroke=\"none\" stroke-width=\"0.6\"/><path d=\"M345,440 l17,-5 M345,460 l17,-5\" stroke=\"#9DBDF2\" stroke-width=\"1.1\"/><text class=\"score\" x=\"353.5\" y=\"257.1784\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"600\" text-anchor=\"middle\">82.7</text><rect x=\"368\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill2)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"368\" y=\"292.506\" width=\"17\" height=\"143.49400000000003\" fill=\"url(#fill2)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M368,440 l17,-5 M368,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><text class=\"score\" x=\"376.5\" y=\"283.506\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">77.6</text><rect x=\"391\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill1)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"391\" y=\"303.03600000000006\" width=\"17\" height=\"132.96399999999994\" fill=\"url(#fill1)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M391,440 l17,-5 M391,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><path d=\"M399.5,264.03600000000006 L399.5,300.03600000000006\" fill=\"none\" stroke=\"#B4B5BA\" stroke-width=\"0.65\"/><text class=\"score\" x=\"399.5\" y=\"260.03600000000006\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">75.6</text><rect x=\"414\" y=\"464\" width=\"17\" height=\"54\" fill=\"#B1B3B8\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"414\" y=\"306.3276\" width=\"17\" height=\"129.67239999999998\" fill=\"#B1B3B8\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M414,440 l17,-5 M414,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><text class=\"score\" x=\"422.5\" y=\"297.3276\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">74.9</text><rect x=\"437\" y=\"470.1524\" width=\"17\" height=\"47.8476\" fill=\"url(#fill3)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><text class=\"score\" x=\"445.5\" y=\"461.1524\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">26.6</text><rect x=\"460\" y=\"472.8866\" width=\"17\" height=\"45.11340000000001\" fill=\"url(#fill4)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M468.5,433.8866 L468.5,469.8866\" fill=\"none\" stroke=\"#B4B5BA\" stroke-width=\"0.65\"/><text class=\"score\" x=\"468.5\" y=\"429.8866\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">25.1</text><text class=\"\" x=\"411\" y=\"546\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"14\" font-weight=\"500\" text-anchor=\"middle\">RubricBench</text><rect x=\"488\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill4)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"488\" y=\"305.4124\" width=\"17\" height=\"130.5876\" fill=\"url(#fill4)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M488,440 l17,-5 M488,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><text class=\"score\" x=\"496.5\" y=\"296.4124\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">75.1</text><rect x=\"511\" y=\"464\" width=\"17\" height=\"54\" fill=\"#9DBDF2\" stroke=\"none\" stroke-width=\"0.6\"/><rect x=\"511\" y=\"310.1184\" width=\"17\" height=\"125.88159999999999\" fill=\"#9DBDF2\" stroke=\"none\" stroke-width=\"0.6\"/><path d=\"M511,440 l17,-5 M511,460 l17,-5\" stroke=\"#9DBDF2\" stroke-width=\"1.1\"/><path d=\"M519.5,271.1184 L519.5,307.1184\" fill=\"none\" stroke=\"#B4B5BA\" stroke-width=\"0.65\"/><text class=\"score\" x=\"519.5\" y=\"267.1184\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"600\" text-anchor=\"middle\">74.2</text><rect x=\"534\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill3)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"534\" y=\"314.8244\" width=\"17\" height=\"121.17559999999997\" fill=\"url(#fill3)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M534,440 l17,-5 M534,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><text class=\"score\" x=\"542.5\" y=\"305.8244\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">73.3</text><rect x=\"557\" y=\"464\" width=\"17\" height=\"54\" fill=\"#B1B3B8\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"557\" y=\"314.8244\" width=\"17\" height=\"121.17559999999997\" fill=\"#B1B3B8\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M557,440 l17,-5 M557,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><path d=\"M565.5,292.8244 L565.5,311.8244\" fill=\"none\" stroke=\"#B4B5BA\" stroke-width=\"0.65\"/><text class=\"score\" x=\"565.5\" y=\"288.8244\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">73.3</text><rect x=\"580\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill1)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"580\" y=\"321.8808\" width=\"17\" height=\"114.11919999999998\" fill=\"url(#fill1)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M580,440 l17,-5 M580,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><text class=\"score\" x=\"588.5\" y=\"312.8808\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">71.9</text><rect x=\"603\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill2)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"603\" y=\"390.1152\" width=\"17\" height=\"45.884799999999984\" fill=\"url(#fill2)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M603,440 l17,-5 M603,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><text class=\"score\" x=\"611.5\" y=\"381.1152\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">58.8</text><text class=\"\" x=\"554\" y=\"546\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"14\" font-weight=\"500\" text-anchor=\"middle\">verify</text><rect x=\"631\" y=\"464\" width=\"17\" height=\"54\" fill=\"#9DBDF2\" stroke=\"none\" stroke-width=\"0.6\"/><rect x=\"631\" y=\"344.324\" width=\"17\" height=\"91.67599999999999\" fill=\"#9DBDF2\" stroke=\"none\" stroke-width=\"0.6\"/><path d=\"M631,440 l17,-5 M631,460 l17,-5\" stroke=\"#9DBDF2\" stroke-width=\"1.1\"/><text class=\"score\" x=\"639.5\" y=\"335.324\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"600\" text-anchor=\"middle\">67.6</text><rect x=\"654\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill2)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"654\" y=\"392.41360000000003\" width=\"17\" height=\"43.58639999999997\" fill=\"url(#fill2)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M654,440 l17,-5 M654,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><text class=\"score\" x=\"662.5\" y=\"383.41360000000003\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">58.4</text><rect x=\"677\" y=\"464\" width=\"17\" height=\"54\" fill=\"url(#fill1)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"677\" y=\"399.9328\" width=\"17\" height=\"36.067200000000014\" fill=\"url(#fill1)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M677,440 l17,-5 M677,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><path d=\"M685.5,360.9328 L685.5,396.9328\" fill=\"none\" stroke=\"#B4B5BA\" stroke-width=\"0.65\"/><text class=\"score\" x=\"685.5\" y=\"356.9328\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">56.9</text><rect x=\"700\" y=\"464\" width=\"17\" height=\"54\" fill=\"#B1B3B8\" stroke=\"#92959B\" stroke-width=\"0.6\"/><rect x=\"700\" y=\"422.4748\" width=\"17\" height=\"13.525199999999984\" fill=\"#B1B3B8\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M700,440 l17,-5 M700,460 l17,-5\" stroke=\"#92959B\" stroke-width=\"1.1\"/><text class=\"score\" x=\"708.5\" y=\"413.4748\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">52.6</text><rect x=\"723\" y=\"491.9882\" width=\"17\" height=\"26.011799999999994\" fill=\"url(#fill4)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><text class=\"score\" x=\"731.5\" y=\"482.9882\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">14.5</text><rect x=\"746\" y=\"497.1902\" width=\"17\" height=\"20.809799999999996\" fill=\"url(#fill3)\" stroke=\"#92959B\" stroke-width=\"0.6\"/><path d=\"M754.5,458.1902 L754.5,494.1902\" fill=\"none\" stroke=\"#B4B5BA\" stroke-width=\"0.65\"/><text class=\"score\" x=\"754.5\" y=\"454.1902\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"middle\">11.6</text><text class=\"\" x=\"697\" y=\"546\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"14\" font-weight=\"500\" text-anchor=\"middle\">writing</text><text class=\"\" x=\"54\" y=\"568\" fill=\"#B4B5BA\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"start\">Axis break: 30 to 50 omitted. The lower section uses a compressed scale.</text><path d=\"M32,586 L768,586\" fill=\"none\" stroke=\"#303136\" stroke-width=\"1\"/><text class=\"\" x=\"32\" y=\"610\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"12\" font-weight=\"600\" text-anchor=\"start\">JudgeBench</text><text class=\"\" x=\"149\" y=\"610\" fill=\"#B4B5BA\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11.4\" font-weight=\"400\" text-anchor=\"start\">Correct choices between a right answer and a wrong answer.</text><text class=\"\" x=\"768\" y=\"610\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"end\">270 pairs</text><text class=\"\" x=\"32\" y=\"637\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"12\" font-weight=\"600\" text-anchor=\"start\">MM-Eval</text><text class=\"\" x=\"149\" y=\"637\" fill=\"#B4B5BA\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11.4\" font-weight=\"400\" text-anchor=\"start\">Judgement across chat, reasoning, safety and language tasks.</text><text class=\"\" x=\"768\" y=\"637\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"end\">591 items</text><text class=\"\" x=\"32\" y=\"664\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"12\" font-weight=\"600\" text-anchor=\"start\">RubricBench</text><text class=\"\" x=\"149\" y=\"664\" fill=\"#B4B5BA\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11.4\" font-weight=\"400\" text-anchor=\"start\">Choices between replies against the stated grading criteria.</text><text class=\"\" x=\"768\" y=\"664\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"end\">1,580 games</text><text class=\"\" x=\"32\" y=\"691\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"12\" font-weight=\"600\" text-anchor=\"start\">verify</text><text class=\"\" x=\"149\" y=\"691\" fill=\"#B4B5BA\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11.4\" font-weight=\"400\" text-anchor=\"start\">LongJudgeBench: checks whether the final answer is correct.</text><text class=\"\" x=\"768\" y=\"691\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"end\">221 items</text><text class=\"\" x=\"32\" y=\"718\" fill=\"#F5F3F0\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"12\" font-weight=\"600\" text-anchor=\"start\">writing</text><text class=\"\" x=\"149\" y=\"718\" fill=\"#B4B5BA\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11.4\" font-weight=\"400\" text-anchor=\"start\">LongJudgeBench: choice of the preferred written reply.</text><text class=\"\" x=\"768\" y=\"718\" fill=\"#F5F3F0\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10.5\" font-weight=\"400\" text-anchor=\"end\">346 games</text><text class=\"\" x=\"149\" y=\"739\" fill=\"#B4B5BA\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11.4\" font-weight=\"400\" text-anchor=\"start\">Reader-first setting: 67.6 shown; default 61.3.</text><text class=\"\" x=\"149\" y=\"756\" fill=\"#B4B5BA\" font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\" font-size=\"11.4\" font-weight=\"400\" text-anchor=\"start\">Same score as a rule that always picks the longer reply (67.6).</text><path d=\"M32,773 L768,773\" fill=\"none\" stroke=\"#303136\" stroke-width=\"1\"/><text class=\"\" x=\"32\" y=\"794\" fill=\"#B4B5BA\" font-family=\"'Geist Mono', ui-monospace, Menlo, monospace\" font-size=\"10\" font-weight=\"400\" text-anchor=\"start\">Source: docs/comparison/benchmarks/*-all-peers.json. Claude Haiku 5.5.</text></svg>"
    },
    "alt": "Judge accuracy on public benchmarks, Claude Haiku 5.5, scores out of 100, bars ranked within each benchmark, driftbench the only coloured bar and each competitor grey with its own pattern, with an axis break from 30 to 50. JudgeBench, 270 pairs: driftbench 88.9, DeepEval 86.3, LangWatch 83.7, promptfoo 83.0, Inspect 80.0, Langfuse 74.8. MM-Eval, 591 items: driftbench 88.9, promptfoo 86.5, DeepEval 84.1, LangWatch 83.9, Inspect 75.4, Langfuse 73.5. RubricBench, 1,580 games: driftbench 82.7, DeepEval 77.6, promptfoo 75.6, LangWatch 74.9, Inspect 26.6, Langfuse 25.1. verify, 221 items: Langfuse 75.1, driftbench 74.2, Inspect 73.3, LangWatch 73.3, promptfoo 71.9, DeepEval 58.8. writing, 346 games: driftbench 67.6, DeepEval 58.4, promptfoo 56.9, LangWatch 52.6, Langfuse 14.5, Inspect 11.6. Reader-first setting: 67.6 shown; default 61.3. Same score as a rule that always picks the longer reply (67.6)."
  }
};
