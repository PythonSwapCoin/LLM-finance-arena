# Simulation Rule Verification

## Trading Rules

The system enforces the following rules:

1. **Initial State:** All agents start with $10,000 cash and no positions
2. **Buy Orders:** Must have sufficient cash (quantity × price ≤ available cash)
3. **Sell Orders:** Can only sell stocks they own (quantity ≤ owned quantity)
4. **Position Tracking:** Average cost is calculated correctly when adding to positions
5. **Validation:** Invalid trades are filtered out with warnings logged

## Verification of Latest Simulation

**Simulation:** `simulation-export-day-7-2025-11-08.json`

### Day 0 (Initial State) ✓
- All 5 agents start with $10,000 cash
- No positions held
- All agents have `portfolioValue: 10000`

### Trade Validation ✓

**Example: Qwen Conservative Agent**
- Day 1: Buys BRK-B 86 shares at $115.89 = $9,966.65
  - Valid: Has $10,000 cash ✓
  - Remaining cash: $33.35
  
- Day 2: Sells BRK-B 20 shares
  - Valid: Owns 86 shares ✓
  - Cash after: $2,291.93
  - Owns: 66 BRK-B shares
  
- Day 3: Sells BRK-B 10 shares, Buys JNJ 7 shares
  - Valid: Owns 66 BRK-B ✓, Has $3,398.15 cash (enough for JNJ) ✓
  
- Day 4: Sells JNJ 7 shares, Buys PG 6 shares
  - Valid: Owns 7 JNJ ✓, Has sufficient cash ✓

**All trades verified:** ✓ Rules are being followed correctly

### Final Portfolio State ✓
- Cash balances are correct
- Position quantities match trade history
- Average costs calculated correctly
- No negative cash or positions

## Validation Layers

1. **LLM Response Validation** (`services/geminiService.ts`):
   - Filters invalid trades before execution
   - Checks ownership for sells
   - Checks cash for buys
   - Validates ticker exists

2. **Execution Safety Checks** (`hooks/useSimulation.ts`):
   - Double-checks cash before buying
   - Uses `Math.min()` for sells (prevents overselling)
   - Logs warnings for invalid trades
   - Only executes valid trades

## Conclusion

✅ **All trading rules are being enforced correctly**
✅ **No rule violations detected in the simulation**
✅ **Validation is working as expected**

