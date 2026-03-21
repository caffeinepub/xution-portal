# XUTION Portal

## Current State
Sector logs and admin feed have scrollable panels but no search. Font is not monospace. Personal fund management add/remove transactions do not appear in transaction history or global ledger.

## Requested Changes (Diff)

### Add
- Search bar above sector logs (filters by content/author)
- Search bar above admin feed (filters by content/author)
- Fund add/remove actions logged as transactions in personal history and global ledger

### Modify
- Global font: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace
- addFunds/removeFunds create transaction entries visible in both personal history and global ledger

### Remove
- Nothing

## Implementation Plan
1. Update global CSS font-family to monospace stack
2. Add sectorLogSearch and adminFeedSearch state; filter logs/posts by term
3. Render search input above each scrollable section
4. On add/remove funds, push transaction record (type ADD_FUNDS/REMOVE_FUNDS, amount, member, timestamp) to transactions array used by personal history and global ledger
