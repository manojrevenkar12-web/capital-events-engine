# 1. Two implementations of the calculations

**Status:** accepted

**Context.** Unit tests check the cases their author thought of, with the author's reading of
the fund documents. The costly mistakes in fund calculations are readings: which commitment a fee
is charged on after the investment period, what happens to an excused investor's share, how
interest on equalisation is split.

**Decision.** Write the contract as a specification (`docs/SPEC.md`). Have a second author
implement it in Python from the specification alone, without seeing the engine, and list every
ambiguity they had to resolve (`reference/NOTES.md`). Generate scenarios and require both
implementations to produce identical output, including the same error code for invalid input.

**Consequences.** Disagreements become spec questions, not bugs to patch quietly; the spec gained
clarifications this way. The cost is a second code base, kept small because it has no I/O.
CI runs 30,000 new scenarios on every push.
