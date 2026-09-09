# Policy Incentives Lab — SYNTHETIC Lantern example

Exploratory scenarios, not forecasts. Artificial agents do not reproduce real human behaviour. Outputs require policy, analytical, legal, financial and operational review. Only public or synthetic material may be used. Do not upload personal data, departmental documents, internal drafts or operationally sensitive content.

**SYNTHETIC EXAMPLE — no real policy or organisation.**

## Source metadata

Title: SYNTHETIC — Lantern Borough Repair Scheme

Publisher: Fictional example

Publication date: Unknown

URL (metadata only; not fetched): Not supplied

SHA-256: a421007e0e06334f7e3bd178ceb0b5f7e1e291ec4fbcf4f8ee5a86a52e53b1e1

## Source evidence

### ev-scheme

Section 1 · explicit · confidence: high

> SYNTHETIC EXAMPLE — fictional Lantern Borough Repair Scheme. Two fictional workshops, Amber and Blue, receive illustrative credits for repairing shared lanterns. Each can choose careful repair or rush its allocation. The intended outcome is reliable lanterns with fair access and controlled resource use. A workshop observes the other workshop’s previous choice after each round. No real organisation, person, programme or policy is represented. All payoff numbers and strategic responses are illustrative model assumptions, not claims from a published policy.

## Assumptions

- behaviour: Illustrative decision rules and causal payoff table; neither describes actual human behaviour. — null; Synthetic fixture author; illustrative; approved
- weight: One credit has payoff weight one for the receiving workshop. — 1; Synthetic fixture author; illustrative; approved
- value-0-0: Illustrative amber-credits for payoff profile 1 — {"low":0,"central":3,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-0-1: Illustrative blue-credits for payoff profile 1 — {"low":0,"central":3,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-0-2: Illustrative reliability for payoff profile 1 — {"low":0,"central":8,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-0-3: Illustrative resource-cost for payoff profile 1 — {"low":0,"central":2,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-1-0: Illustrative amber-credits for payoff profile 2 — {"low":0,"central":0,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-1-1: Illustrative blue-credits for payoff profile 2 — {"low":0,"central":5,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-1-2: Illustrative reliability for payoff profile 2 — {"low":0,"central":4,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-1-3: Illustrative resource-cost for payoff profile 2 — {"low":0,"central":4,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-2-0: Illustrative amber-credits for payoff profile 3 — {"low":0,"central":5,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-2-1: Illustrative blue-credits for payoff profile 3 — {"low":0,"central":0,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-2-2: Illustrative reliability for payoff profile 3 — {"low":0,"central":4,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-2-3: Illustrative resource-cost for payoff profile 3 — {"low":0,"central":4,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-3-0: Illustrative amber-credits for payoff profile 4 — {"low":0,"central":1,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-3-1: Illustrative blue-credits for payoff profile 4 — {"low":0,"central":1,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-3-2: Illustrative reliability for payoff profile 4 — {"low":0,"central":2,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved
- value-3-3: Illustrative resource-cost for payoff profile 4 — {"low":0,"central":6,"high":10}; Synthetic fixture author — not source evidence; illustrative; approved

## Approved model and item approvals

```json
{
  "version": 1,
  "approval_status": {
    "status": "approved",
    "approved_by": "synthetic-reviewer",
    "approved_at": "2026-01-01T00:00:00.000Z"
  },
  "objectives": [
    {
      "id": "objective",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Explore reliable lantern repair",
      "evidence_refs": [
        "ev-scheme"
      ],
      "assumption_refs": []
    }
  ],
  "operative_mechanisms": [
    {
      "id": "mechanism",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Credits reward workshop choices",
      "evidence_refs": [
        "ev-scheme"
      ],
      "assumption_refs": []
    }
  ],
  "actors": [
    {
      "id": "amber",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "name": "Amber Workshop",
      "description": "Fictional workshop; no real organisation.",
      "objectives": [
        {
          "id": "amber-objective",
          "approval_status": {
            "status": "approved",
            "approved_by": "synthetic-reviewer",
            "approved_at": "2026-01-01T00:00:00.000Z"
          },
          "statement": "Receive illustrative repair credits",
          "evidence_refs": [
            "ev-scheme"
          ],
          "assumption_refs": []
        }
      ],
      "constraints": [
        {
          "id": "amber-constraint",
          "approval_status": {
            "status": "approved",
            "approved_by": "synthetic-reviewer",
            "approved_at": "2026-01-01T00:00:00.000Z"
          },
          "statement": "Choose careful repair or rush the allocation",
          "evidence_refs": [
            "ev-scheme"
          ],
          "assumption_refs": []
        }
      ],
      "resources": [
        {
          "id": "amber-resource",
          "approval_status": {
            "status": "approved",
            "approved_by": "synthetic-reviewer",
            "approved_at": "2026-01-01T00:00:00.000Z"
          },
          "statement": "An allocation of fictional lantern repairs",
          "evidence_refs": [
            "ev-scheme"
          ],
          "assumption_refs": []
        }
      ],
      "information_available": [
        {
          "id": "amber-info",
          "approval_status": {
            "status": "approved",
            "approved_by": "synthetic-reviewer",
            "approved_at": "2026-01-01T00:00:00.000Z"
          },
          "statement": "The previous-round choice is observable",
          "evidence_refs": [
            "ev-scheme"
          ],
          "assumption_refs": []
        }
      ],
      "information_hidden": [],
      "evidence_refs": [
        "ev-scheme"
      ],
      "assumption_refs": []
    },
    {
      "id": "blue",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "name": "Blue Workshop",
      "description": "Fictional workshop; no real organisation.",
      "objectives": [
        {
          "id": "blue-objective",
          "approval_status": {
            "status": "approved",
            "approved_by": "synthetic-reviewer",
            "approved_at": "2026-01-01T00:00:00.000Z"
          },
          "statement": "Receive illustrative repair credits",
          "evidence_refs": [
            "ev-scheme"
          ],
          "assumption_refs": []
        }
      ],
      "constraints": [
        {
          "id": "blue-constraint",
          "approval_status": {
            "status": "approved",
            "approved_by": "synthetic-reviewer",
            "approved_at": "2026-01-01T00:00:00.000Z"
          },
          "statement": "Choose careful repair or rush the allocation",
          "evidence_refs": [
            "ev-scheme"
          ],
          "assumption_refs": []
        }
      ],
      "resources": [
        {
          "id": "blue-resource",
          "approval_status": {
            "status": "approved",
            "approved_by": "synthetic-reviewer",
            "approved_at": "2026-01-01T00:00:00.000Z"
          },
          "statement": "An allocation of fictional lantern repairs",
          "evidence_refs": [
            "ev-scheme"
          ],
          "assumption_refs": []
        }
      ],
      "information_available": [
        {
          "id": "blue-info",
          "approval_status": {
            "status": "approved",
            "approved_by": "synthetic-reviewer",
            "approved_at": "2026-01-01T00:00:00.000Z"
          },
          "statement": "The previous-round choice is observable",
          "evidence_refs": [
            "ev-scheme"
          ],
          "assumption_refs": []
        }
      ],
      "information_hidden": [],
      "evidence_refs": [
        "ev-scheme"
      ],
      "assumption_refs": []
    }
  ],
  "strategies": [
    {
      "id": "amber-careful",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "actor_id": "amber",
      "name": "careful",
      "description": "Choose careful repair",
      "preconditions": [],
      "expected_direct_effects": [],
      "evidence_refs": [
        "ev-scheme"
      ],
      "assumption_refs": []
    },
    {
      "id": "amber-rush",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "actor_id": "amber",
      "name": "rush",
      "description": "Choose rush repair",
      "preconditions": [],
      "expected_direct_effects": [],
      "evidence_refs": [
        "ev-scheme"
      ],
      "assumption_refs": []
    },
    {
      "id": "blue-careful",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "actor_id": "blue",
      "name": "careful",
      "description": "Choose careful repair",
      "preconditions": [],
      "expected_direct_effects": [],
      "evidence_refs": [
        "ev-scheme"
      ],
      "assumption_refs": []
    },
    {
      "id": "blue-rush",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "actor_id": "blue",
      "name": "rush",
      "description": "Choose rush repair",
      "preconditions": [],
      "expected_direct_effects": [],
      "evidence_refs": [
        "ev-scheme"
      ],
      "assumption_refs": []
    }
  ],
  "outcome_metrics": [
    {
      "id": "amber-credits",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "name": "amber credits",
      "description": "Illustrative scenario metric",
      "unit": "fictional credits",
      "desired_direction": "increase",
      "policy_priority": "secondary",
      "measurement_limitations": "Arbitrary toy scale; no real fiscal, distributional or operational estimate.",
      "evidence_refs": [],
      "assumption_refs": [
        "behaviour"
      ]
    },
    {
      "id": "blue-credits",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "name": "blue credits",
      "description": "Illustrative scenario metric",
      "unit": "fictional credits",
      "desired_direction": "increase",
      "policy_priority": "secondary",
      "measurement_limitations": "Arbitrary toy scale; no real fiscal, distributional or operational estimate.",
      "evidence_refs": [],
      "assumption_refs": [
        "behaviour"
      ]
    },
    {
      "id": "reliability",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "name": "reliability",
      "description": "Illustrative scenario metric",
      "unit": "illustrative units",
      "desired_direction": "increase",
      "policy_priority": "primary",
      "measurement_limitations": "Arbitrary toy scale; no real fiscal, distributional or operational estimate.",
      "evidence_refs": [],
      "assumption_refs": [
        "behaviour"
      ]
    },
    {
      "id": "resource-cost",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "name": "resource cost",
      "description": "Illustrative scenario metric",
      "unit": "illustrative units",
      "desired_direction": "decrease",
      "policy_priority": "secondary",
      "measurement_limitations": "Arbitrary toy scale; no real fiscal, distributional or operational estimate.",
      "evidence_refs": [],
      "assumption_refs": [
        "behaviour"
      ]
    }
  ],
  "payoff_components": [
    {
      "id": "amber-payoff",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "actor_id": "amber",
      "outcome_metric_id": "amber-credits",
      "weight_or_range": "weight",
      "rationale": "Illustrative self-interested credit preference",
      "provenance": "Synthetic fixture author",
      "evidence_refs": [],
      "assumption_refs": [
        "behaviour"
      ]
    },
    {
      "id": "blue-payoff",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "actor_id": "blue",
      "outcome_metric_id": "blue-credits",
      "weight_or_range": "weight",
      "rationale": "Illustrative self-interested credit preference",
      "provenance": "Synthetic fixture author",
      "evidence_refs": [],
      "assumption_refs": [
        "behaviour"
      ]
    }
  ],
  "interactions": [
    {
      "id": "interaction",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "actor_ids": [
        "amber",
        "blue"
      ],
      "sequence": 0,
      "information_structure": "observable",
      "repeat_frequency": "Once per configured round",
      "dependency": "For sequential mode Amber moves first and Blue observes; for repeated mode both observe the previous round.",
      "evidence_refs": [],
      "assumption_refs": [
        "behaviour"
      ]
    }
  ],
  "assumptions": [
    {
      "id": "behaviour",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative decision rules and causal payoff table; neither describes actual human behaviour.",
      "type": "behavioural",
      "value_or_range": null,
      "source": "Synthetic fixture author",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "weight",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "One credit has payoff weight one for the receiving workshop.",
      "type": "numerical",
      "value_or_range": 1,
      "source": "Synthetic fixture author",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "low"
    },
    {
      "id": "value-0-0",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative amber-credits for payoff profile 1",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 3,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-0-1",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative blue-credits for payoff profile 1",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 3,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-0-2",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative reliability for payoff profile 1",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 8,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-0-3",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative resource-cost for payoff profile 1",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 2,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-1-0",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative amber-credits for payoff profile 2",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 0,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-1-1",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative blue-credits for payoff profile 2",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 5,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-1-2",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative reliability for payoff profile 2",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 4,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-1-3",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative resource-cost for payoff profile 2",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 4,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-2-0",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative amber-credits for payoff profile 3",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 5,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-2-1",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative blue-credits for payoff profile 3",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 0,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-2-2",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative reliability for payoff profile 3",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 4,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-2-3",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative resource-cost for payoff profile 3",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 4,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-3-0",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative amber-credits for payoff profile 4",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 1,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-3-1",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative blue-credits for payoff profile 4",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 1,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-3-2",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative reliability for payoff profile 4",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 2,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    },
    {
      "id": "value-3-3",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Illustrative resource-cost for payoff profile 4",
      "type": "numerical",
      "value_or_range": {
        "low": 0,
        "central": 6,
        "high": 10
      },
      "source": "Synthetic fixture author — not source evidence",
      "confidence": "illustrative",
      "approved_by_user": true,
      "sensitivity_priority": "high"
    }
  ],
  "intended_outcomes": [
    {
      "id": "intended",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "Reliable lanterns with fair access and controlled resource use",
      "evidence_refs": [
        "ev-scheme"
      ],
      "assumption_refs": []
    }
  ],
  "causal_relationships": [
    {
      "id": "causal",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "statement": "The illustrative payoff table assumes rushing reduces reliability and raises resource cost.",
      "evidence_refs": [],
      "assumption_refs": [
        "behaviour"
      ]
    }
  ],
  "payoff_table": [
    {
      "id": "row-0",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "profile": {
        "amber": "amber-careful",
        "blue": "blue-careful"
      },
      "outcome_values": {
        "amber-credits": "value-0-0",
        "blue-credits": "value-0-1",
        "reliability": "value-0-2",
        "resource-cost": "value-0-3"
      },
      "evidence_refs": [],
      "assumption_refs": [
        "behaviour"
      ]
    },
    {
      "id": "row-1",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "profile": {
        "amber": "amber-careful",
        "blue": "blue-rush"
      },
      "outcome_values": {
        "amber-credits": "value-1-0",
        "blue-credits": "value-1-1",
        "reliability": "value-1-2",
        "resource-cost": "value-1-3"
      },
      "evidence_refs": [],
      "assumption_refs": [
        "behaviour"
      ]
    },
    {
      "id": "row-2",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "profile": {
        "amber": "amber-rush",
        "blue": "blue-careful"
      },
      "outcome_values": {
        "amber-credits": "value-2-0",
        "blue-credits": "value-2-1",
        "reliability": "value-2-2",
        "resource-cost": "value-2-3"
      },
      "evidence_refs": [],
      "assumption_refs": [
        "behaviour"
      ]
    },
    {
      "id": "row-3",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "profile": {
        "amber": "amber-rush",
        "blue": "blue-rush"
      },
      "outcome_values": {
        "amber-credits": "value-3-0",
        "blue-credits": "value-3-1",
        "reliability": "value-3-2",
        "resource-cost": "value-3-3"
      },
      "evidence_refs": [],
      "assumption_refs": [
        "behaviour"
      ]
    }
  ],
  "decision_rules": [
    {
      "id": "amber-rule",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "actor_id": "amber",
      "rule": "maximise",
      "threshold_assumption": null,
      "schedule": [],
      "evidence_refs": [],
      "assumption_refs": [
        "behaviour"
      ]
    },
    {
      "id": "blue-rule",
      "approval_status": {
        "status": "approved",
        "approved_by": "synthetic-reviewer",
        "approved_at": "2026-01-01T00:00:00.000Z"
      },
      "actor_id": "blue",
      "rule": "maximise",
      "threshold_assumption": null,
      "schedule": [],
      "evidence_refs": [],
      "assumption_refs": [
        "behaviour"
      ]
    }
  ],
  "model_limitations": [
    "SYNTHETIC example. No real policy, organisation or population is modelled.",
    "Finite strategy choices and fixed payoffs omit learning, institutions, heterogeneous needs and real behavioural evidence.",
    "Optimistic and adverse labels do not automatically select parameter directions; the user must configure approved values."
  ]
}
```

## Deterministic calculations and run configuration

```json
{
  "synthetic": true,
  "policy_version": "a421007e0e06334f7e3bd178ceb0b5f7e1e291ec4fbcf4f8ee5a86a52e53b1e1",
  "approved_model_version": 1,
  "engine_version": "1.0.0",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "config": {
    "simulation_type": "normal-form",
    "seed": 42,
    "rounds": 1,
    "scenario": "baseline",
    "parameters": {}
  },
  "result": {
    "engine_version": "1.0.0",
    "simulation_type": "normal-form",
    "parameters": {
      "weight": 1,
      "value-0-0": 3,
      "value-0-1": 3,
      "value-0-2": 8,
      "value-0-3": 2,
      "value-1-0": 0,
      "value-1-1": 5,
      "value-1-2": 4,
      "value-1-3": 4,
      "value-2-0": 5,
      "value-2-1": 0,
      "value-2-2": 4,
      "value-2-3": 4,
      "value-3-0": 1,
      "value-3-1": 1,
      "value-3-2": 2,
      "value-3-3": 6
    },
    "equilibria": [
      {
        "profile": {
          "amber": "amber-rush",
          "blue": "blue-rush"
        },
        "outcomes": {
          "amber-credits": 1,
          "blue-credits": 1,
          "reliability": 2,
          "resource-cost": 6
        },
        "payoffs": {
          "amber": 1,
          "blue": 1
        },
        "terms": [
          {
            "actor": "amber",
            "metric": "amber-credits",
            "value": 1,
            "weight": 1,
            "product": 1
          },
          {
            "actor": "blue",
            "metric": "blue-credits",
            "value": 1,
            "weight": 1,
            "product": 1
          }
        ]
      }
    ],
    "rounds": [],
    "terminal_outcomes": [
      {
        "profile": {
          "amber": "amber-rush",
          "blue": "blue-rush"
        },
        "outcomes": {
          "amber-credits": 1,
          "blue-credits": 1,
          "reliability": 2,
          "resource-cost": 6
        },
        "payoffs": {
          "amber": 1,
          "blue": 1
        },
        "terms": [
          {
            "actor": "amber",
            "metric": "amber-credits",
            "value": 1,
            "weight": 1,
            "product": 1
          },
          {
            "actor": "blue",
            "metric": "blue-credits",
            "value": 1,
            "weight": 1,
            "product": 1
          }
        ]
      }
    ],
    "notices": [
      "Exploratory scenarios, not forecasts. Artificial agents do not reproduce real human behaviour.",
      "Payoffs use only approved numerical assumptions. Qualitative preconditions and causal statements document the table; they are not executable code. All listed strategies must be feasible in this normal-form representation.",
      "1 pure-strategy Nash equilibrium/equilibria. Existence does not predict selection."
    ]
  },
  "result_hash": "a3aeb41d4a4bc92dc6b4af258cb2ed3615f1741c393cec94fbf2adb6cc802424"
}
```

## Hypotheses — not findings

No red-team hypotheses recorded.

## Recommendations for review

Compare intended outcomes against the calculated outcome ranges. Consider auditing reward rules, monitoring cost shifting and testing safeguards as separately approved scenarios. These are review prompts, not established policy recommendations.

## Fiscal, distributional and operational limitations

Effects outside explicitly approved outcome metrics are unknown. No legal, financial or operational assurance is implied.

- SYNTHETIC example. No real policy, organisation or population is modelled.
- Finite strategy choices and fixed payoffs omit learning, institutions, heterogeneous needs and real behavioural evidence.
- Optimistic and adverse labels do not automatically select parameter directions; the user must configure approved values.

## Extraction audit



Raw responses, original source sections and complete audit history are included in the JSON export.
