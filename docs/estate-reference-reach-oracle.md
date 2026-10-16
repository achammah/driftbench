# Chained-reference oracle

The chained-reference item requires a skill to reach the reference stated inside its first guide. It retains the planted inner-reference atom and the guide's rules. It does not prescribe how the graph stores transitive reach.

The assertion follows each reference atom's resolved target path from the owner's definition file. A visited-file set terminates cycles. The check rejects a missing owner or inner-reference atom and a disconnected citation chain. A stale materialized owner-to-inner edge cannot make a disconnected chain pass.

Only this item's transitive edge assertion changes to a property check. Its tier, level, expected atoms, direct first-reference edge and all other items remain unchanged.

Regression evidence:

- Extracting the previous materialized-edge predicate gives two failures and two passes: direct-only storage is rejected, while a stale closure edge incorrectly passes a disconnected chain.
- The citation-path predicate passes all four regression cases. A product projection missing the inner reference still fails; so do a disconnected bridge and a wrong-folder cycle.
- An independent read-only review reports PASS. It reruns the four tests and checks the actual family on seeds 1 and 927 with in-memory scan mutations. Direct-only storage passes; a disconnected bridge with a stale edge fails.

The committed regression file tests the assertion directly. The independent review separately verifies registration on the actual chained item. The product scanner on main has its existing reader gaps; this oracle change does not mask them.
