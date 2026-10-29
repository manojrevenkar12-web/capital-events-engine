# 2. Approvals sign a result, not an event

**Status:** accepted

**Context.** A four-eyes rule that approves "the event" can be bypassed by accident: the event is
approved, then a side letter is approved or a commitment changes, the event is recalculated, and
the notices go out with numbers nobody checked.

**Decision.** Every calculation stores a SHA-256 of its canonical result. An approval records the
hash it approved. Issuing locks the fund, recalculates, and refuses unless the result's hash is
the approved one, so a result other events have made stale cannot go out. The
console draws the hash as a glyph, so an approver sees which result they are signing and a void
approval looks void.

**Consequences.** Recalculating is cheap and safe. A reviewer's approval is evidence about a
specific set of numbers, which is what an auditor asks for.
