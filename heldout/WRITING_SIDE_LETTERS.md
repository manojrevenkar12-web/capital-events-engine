# Writing a held-out set of side letters

A held-out set measures how well the side-letter extractor reads letters it has never seen. It
is only worth anything if its author has not seen the extractor. If you are writing a set: do
not open `apps/api/src/side-letters/`, the tests, or any other set. Read only this guide.

## What to write

Write 24 to 30 side letters as plain-text files `letters/NN.txt` (01, 02, ...), the kind a fund
administrator receives from law firms for a European private equity or venture fund. Vary
them the way real ones vary:

- Length: from a five-line letter granting one thing to a two-page letter with recitals,
  definitions, a dozen numbered clauses, and boilerplate about confidentiality, governing law,
  counterparts and severability (boilerplate grants nothing).
- Drafting style: British and American spelling, numbered and lettered clauses, "the General
  Partner shall", "the Investor will be entitled to", "notwithstanding Clause 7.2 of the LPA",
  defined terms in capitals, cross-references, amounts in words and figures.
- Investors: pension funds, insurers, family offices, sovereign funds, foundations, church
  funds, public bodies subject to transparency laws, funds of funds, a feeder.
- Letters that grant something conditionally ("if the Investor's Commitment exceeds EUR 25
  million"), that refer to a term without granting it ("the Investor acknowledges that no fee
  discount is offered"), and that grant several things in one sentence.
- At least three letters must contain a trap: something that looks like a grant but is not
  (a recital describing what another investor asked for, a refusal, a definition).

## What each letter may grant

Label every grant with one of these types, its parameters and a category.

| type | params | when |
|---|---|---|
| `FEE_DISCOUNT` | `{"bps": int}` | the management fee is reduced. If the letter states a new rate instead, the discount is the fund's rate minus it. The fund's management fee is 200 bps (2.0%) unless the letter says otherwise. |
| `CARRY_DISCOUNT` | `{"bps": int}` | carried interest is reduced. The fund's carry is 2000 bps (20%); a letter giving "15% carried interest" is a 500 bps discount. |
| `EXCUSE_RIGHT` | `{"sectors": [..]}` | the investor need not fund certain investments. Sectors use only these names: `tobacco`, `gambling`, `weapons`, `fossil_fuels`, `adult_entertainment`, `alcohol`, `nuclear`, `cannabis`. |
| `NOTICE_PERIOD` | `{"days": int}` | a longer notice period for capital calls, in business days |
| `REPORTING` | `{"report": "<frequency> <topic>"}` | extra reports, e.g. `"quarterly esg"`, `"annual pai"`, `"annual carbon"` (lower case) |
| `MFN` | `{}` | a most-favoured-nation right |
| `LPAC_SEAT` | `{"seat": true}` | a seat or observer on the advisory committee |
| `CO_INVEST` | `{"rights": "co-investment offers"}` | co-investment offers or rights |
| `TAX` | `{"topic": "withholding" or "tax status"}` | tax-specific undertakings |
| `DISCLOSURE` | `{"topic": "public disclosure laws"}` | freedom-of-information or public-records carve-outs |

Categories: `ECONOMIC` (fee, carry, excuse rights for ordinary ESG reasons), `REPORTING`,
`GOVERNANCE` (notice periods, MFN), `REGULATORY_LP_SPECIFIC` (excuse rights or disclosure the
investor needs because of the law, regulation, its charter or religion that applies to it),
`TAX_LP_SPECIFIC`, `LPAC_SEAT`, `FIRST_CLOSE_INCENTIVE` (a discount given for coming in at
the first closing), `CO_INVEST`.

## The answer file

`answers.json`: for every letter, the list of grants:

```json
{
  "01": [
    {"type": "FEE_DISCOUNT", "params": {"bps": 25}, "category": "ECONOMIC",
     "quote": "the exact sentence that grants it, copied character for character"}
  ],
  "02": []
}
```

The quote must be copied exactly from the letter (it is checked). A letter that grants
nothing has an empty list. Do not label boilerplate. A conditional grant is labelled if the
condition is about the investor in a way the letter itself settles (e.g. its commitment is
stated in the letter); otherwise it is not.

## After writing

Write `STATUS` containing `held-out`, and a short `NOTES.md`: how many letters, how many
grants of each type, which letters contain traps and what they are. Then stop. The set is
scored once (`pnpm --filter @cee/api heldout`), the first result is stored in
`reports/heldout/side-letters-v1/first_run.json` with the set's sha256, and it is never
rewritten. If anyone studies the failures to change the extractor, the set becomes a
regression set (`STATUS` = `regression`) and a new set must be written from this guide.
