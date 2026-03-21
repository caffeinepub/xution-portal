# XUTION Portal

## Current State
Version 66. Fund management has add/remove by user with search. Personal and global transaction histories exist. Global ledger has a REVERSE button. Purchases log transactions. However:
- The canister poll overwrites `allTransactions` state without preserving `reversed`/`reversedBy` flags from local storage, so reversed entries un-reverse themselves after 5 seconds.
- Reversal entries (new transaction with `REVERSED:` description) are logged locally and to canister but the original entry's `reversed: true` flag is not persisted to the canister, so it's lost on other devices.
- Personal transaction history has no search bar.
- Fund management add/remove descriptions could more clearly attribute who made the change and to whom.

## Requested Changes (Diff)

### Add
- Search bar on personal transaction history
- After reversal, immediately re-merge so `reversed` status persists in the UI without waiting for next poll

### Modify
- Canister poll merge: preserve `reversed`/`reversedBy` from local storage when updating `allTransactions` state; also include local-only entries (e.g. very recent reversals) not yet on canister
- Fund adjustment descriptions: show `ADD FUNDS TO [member] BY [admin]` and `REMOVE FUNDS FROM [member] BY [admin]` so global ledger shows who was affected
- Global ledger: after REVERSE, immediately update the allTransactions state (via callback or local re-merge) so UI reflects it without waiting 5 seconds
- Personal transaction history: filter shows entries for current user from merged canister+local, including fund adjustments made by L6

### Remove
- Nothing

## Implementation Plan
1. Add `search` state to `PersonalTransactionHistory`; render a search input that filters `txns` by `t.description`
2. Fix canister poll merge in the 5-second useEffect: after mapping canister results, merge with local to preserve `reversed`/`reversedBy` flags and include local-only entries
3. In `handleReverse` (GlobalTransactionHistory), after updating localStorage, force a state refresh so `allTransactions` immediately reflects the reversed status — add an `onReverse` callback prop
4. Update `handleAdjust` description to `ADD FUNDS TO ${adjustMember} BY ${currentUser.name}` and `REMOVE FUNDS FROM ${adjustMember} BY ${currentUser.name}` for clearer global ledger attribution
5. Ensure `handleSet` description similarly shows `FUND SET FOR ${name} BY ${currentUser.name}`
