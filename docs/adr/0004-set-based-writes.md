# 4. Set-based writes for per-investor work, verified by posting counts

**Status:** accepted

**Context.** The first implementation applied payments and assigned references one investor at a
time. At 5,000 LPs a camt.054 import took 40 s, holding locks the whole time.

**Decision.** Aggregate in memory, then write with `UPDATE ... JOIN (VALUES ROW(...))` and chunked
multi-row inserts. The benchmark records ledger posting counts next to timings, because a faster
write path that changes what is booked is not an optimisation.

**Consequences.** Import 40.1 s → 1.27 s. The first batched version collapsed bank lines and lost
the event on multi-event journals; the posting count exposed it (74,002 → 69,003) and a test now
pins one journal per event and one bank line per credit. Admitting investors at a closing is still
per row (see the technical-debt register).
