"""Section 6: MFN eligibility."""

from conftest import err, ok

LPS = [{"id": "E", "commitment": 1000}, {"id": "A", "commitment": 500},
       {"id": "B", "commitment": 1000}, {"id": "C", "commitment": 2000}]


def prov(id, lp, type, params, category="ECONOMIC"):
    return {"id": id, "lp": lp, "type": type, "params": params, "category": category}


PROVISIONS = [
    prov("p01", "A", "FEE_DISCOUNT", {"bps": 50}),            # E holds 60 >= 50
    prov("p02", "C", "FEE_DISCOUNT", {"bps": 100}),           # C is larger: size tier
    prov("p03", "B", "FEE_DISCOUNT", {"bps": 75}),            # equal commitment is allowed
    prov("p04", "A", "LPAC", {}, "LPAC_SEAT"),                # carve-out
    prov("p05", "A", "MFN", {}),                              # MFN itself
    prov("p06", "E", "FEE_DISCOUNT", {"bps": 60}),            # E's own
    prov("p07", "A", "NOTICE_PERIOD", {"days": 15}),          # E holds 15
    prov("p08", "E", "NOTICE_PERIOD", {"days": 15}),
    prov("p09", "B", "NOTICE_PERIOD", {"days": 20}),
    prov("p10", "A", "EXCUSE_RIGHT", {"sectors": ["oil", "coal"]}),  # covered by E's union
    prov("p11", "E", "EXCUSE_RIGHT", {"sectors": ["oil"]}),
    prov("p12", "E", "EXCUSE_RIGHT", {"sectors": ["coal"]}),
    prov("p13", "B", "EXCUSE_RIGHT", {"sectors": ["oil", "arms"]}),
    prov("p14", "A", "REPORTING", {"report": "ESG"}, "REPORTING"),   # E holds the same
    prov("p15", "E", "REPORTING", {"report": "ESG"}, "REPORTING"),
    prov("p16", "B", "REPORTING", {"report": "quarterly"}, "REPORTING"),
    prov("p17", "A", "REPORTING", {"report": "quarterly"}, "REPORTING"),  # duplicate of p16
    prov("p18", "A", "CUSTOM", {"tags": ["x", "y"]}, "GOVERNANCE"),
    prov("p19", "B", "CUSTOM", {"tags": ["y", "x", "x"]}, "GOVERNANCE"),  # same as a set
    prov("p20", "E", "CUSTOM", {"tags": ["z"]}, "GOVERNANCE"),
    prov("p21", "A", "FEE_DISCOUNT", {"bps": 75}),            # duplicate of p03
    prov("p22", "A", "CARRY_DISCOUNT", {"bps": 100}, "TAX_LP_SPECIFIC"),
    prov("p23", "A", "CARRY_DISCOUNT", {"bps": 100}, "FIRST_CLOSE_INCENTIVE"),
    prov("p24", "A", "CO_INVEST_RIGHT", {}, "CO_INVEST"),
    prov("p25", "A", "ERISA", {}, "REGULATORY_LP_SPECIFIC"),
    prov("p26", "A", "CARRY_DISCOUNT", {"bps": 100}),
]


def test_eligibility_rules():
    out = ok("mfn", {"lps": LPS, "provisions": PROVISIONS, "electing_lp": "E"})
    assert out == {"eligible": ["p03", "p09", "p13", "p16", "p18", "p26"]}


def test_order_of_input_does_not_matter():
    out = ok("mfn", {"lps": LPS, "provisions": list(reversed(PROVISIONS)), "electing_lp": "E"})
    assert out == {"eligible": ["p03", "p09", "p13", "p16", "p18", "p26"]}


def test_own_carve_out_provision_still_counts_as_held():
    provs = [prov("a", "A", "FEE_DISCOUNT", {"bps": 50}),
             prov("b", "E", "FEE_DISCOUNT", {"bps": 100}, "FIRST_CLOSE_INCENTIVE")]
    assert ok("mfn", {"lps": LPS, "provisions": provs, "electing_lp": "E"}) == {"eligible": []}


def test_empty_excuse_right_is_already_held():
    provs = [prov("a", "A", "EXCUSE_RIGHT", {"sectors": []})]
    assert ok("mfn", {"lps": LPS, "provisions": provs, "electing_lp": "E"}) == {"eligible": []}


def test_params_equality_types():
    provs = [prov("a", "A", "X", {"v": 1}), prov("b", "A", "X", {"v": True}),
             prov("c", "A", "X", {"v": "1"}), prov("d", "B", "X", {"v": 1, "w": None}),
             prov("e", "B", "X", {"v": 1})]
    out = ok("mfn", {"lps": LPS, "provisions": provs, "electing_lp": "E"})
    assert out == {"eligible": ["a", "b", "c", "d"]}


def test_errors():
    provs = [prov("a", "Z", "X", {})]
    assert err("mfn", {"lps": LPS, "provisions": provs, "electing_lp": "E"})["error"] == "INVALID_INPUT"
    assert err("mfn", {"lps": LPS, "provisions": [], "electing_lp": "Q"})["error"] == "INVALID_INPUT"
    provs = [prov("a", "A", "FEE_DISCOUNT", {})]
    assert err("mfn", {"lps": LPS, "provisions": provs, "electing_lp": "E"})["error"] == "INVALID_INPUT"
    provs = [prov("a", "A", "X", {}), prov("a", "B", "Y", {})]
    assert err("mfn", {"lps": LPS, "provisions": provs, "electing_lp": "E"})["error"] == "INVALID_INPUT"
