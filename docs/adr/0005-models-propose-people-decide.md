# 5. Extraction proposes; a second person decides

**Status:** accepted

**Context.** Side letters are free text. A term read wrongly changes money: a fee discount, an
excuse right, a notice period.

**Decision.** Extractors (deterministic rules, or Claude with a zod-validated tool schema) only
propose provisions, each with the exact sentence it came from. A proposal whose quote cannot be
found in the letter is discarded. Calculations read approved provisions only, and the person who
uploaded a letter cannot approve its terms.

**Consequences.** Extraction quality affects how much reviewing there is, not what is paid. It is
measured on letters written blind (`heldout/`), scored once, with the first run pinned.
