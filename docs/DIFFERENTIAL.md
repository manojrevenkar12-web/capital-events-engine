# Differential testing against a blind reference

## Set-up

`docs/SPEC.md` is the calculation contract: conventions (rounding, allocation, business days),
capital calls, equalisation, the waterfall, feeders, MFN, the scenario format and error codes.

`reference/` was written by a separate author who was given the specification and nothing else.
Wherever the spec could be read two ways, they chose the most literal reading and wrote it down:
`reference/NOTES.md` lists those choices by section. Several became clarifications in the spec
(components identified by `kind`; a negative unfunded commitment is an `OVER_CALL`, not a
silently clamped zero).

`tools/differential/generate.ts` produces seeded scenarios across seven operations, biased toward
the hard cases: excused investors, investors near their commitment limit, fee periods across the
end of the investment period, February 29 anniversaries, tiny and huge amounts, tied remainders.
`compare.ts` runs the engine in-process and the reference in batch mode, and compares parsed JSON
for every scenario, including which error code an invalid one produces.

## Results

| Run | Scenarios | Differences | Errors exercised |
|---|---|---|---|
| First run (committed, `reports/differential/first-run.json`) | 6,000 | 0 | 1,212 scenarios ended in an error code, on purpose |
| After tuning the generator toward valid calls (`latest.json`) | 6,000 | 0 | OVER_CALL 354, INSUFFICIENT_UNFUNDED 67, UNSUPPORTED_FEE_PERIOD 4 |
| Seed 7 | 30,000 | 0 | |
| Every CI run (seed = run number) | 30,000 | 0 required | |

By operation (latest committed run): allocation 546, business days 546, capital calls 1,092,
equalisation 1,091, distributions 1,090, feeder calls 545, MFN 1,090.

The generator was tuned after its first run because 795 of 1,092 calls ended in an error, which
tested error ordering well and arithmetic badly. The first run is kept as it was.

## What it does not prove

Both implementations follow the same specification, so a wrong specification is wrong twice.
The defence there is review of `docs/SPEC.md` by someone who knows the fund documents, and the
hand-worked examples in the engine's tests.
