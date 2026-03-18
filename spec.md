# XUTION Portal

## Current State

- Transaction history exists for both personal (PersonalTransactionHistory) and global (GlobalTransactionHistory) views
- Transactions are synced to canister on write, and loaded from canister on login, but NOT polled in real-time -- other devices only see new transactions after re-login
- Member Directory is collapsible and scrollable but has no search/filter input
- Sovereign Database (L6 admin panel) lists all members but has no search/filter input
- Real-time canister polling exists for logs, posts, menu items, funds, lockdown -- but NOT transactions

## Requested Changes (Diff)

### Add
- Search bar in Member Directory to filter members by name
- Search bar in Sovereign Database to filter members by name
- Real-time canister polling for transactions (every 5s) so all devices see new purchases/fund changes live
- Transaction history display already shows `description` (purchase name), but ensure the poll loop writes to state so the UI updates cross-device

### Modify
- PersonalTransactionHistory: poll from canister state (via React state, not just localStorage) so purchases appear immediately cross-device
- GlobalTransactionHistory: same -- read from canister-polled state
- Main polling loop: add `getAllTransactions` polling every 5s, update local transaction state

### Remove
- Nothing removed

## Implementation Plan

1. Add `transactions` state at app level, populated from canister poll every 5s via `actor.getAllTransactions()`
2. Pass transactions state down to PersonalTransactionHistory and GlobalTransactionHistory so they read live canister data
3. Add `memberSearch` state to MemberDirectory component; render a search input when expanded; filter `memberNames` by search term
4. Add `sovereignSearch` state to Sovereign Database section in admin panel; render a search input; filter `memberNames` by search term
