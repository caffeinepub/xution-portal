# XUTION Portal

## Current State
Full-stack XUTION portal with auth, facility directory, sector workspace, credit card, fund management, DM system, member directory, office locations, and lockdown. Purchases via facility menu and personal fund management deduct from balance immediately on click without any confirmation step.

## Requested Changes (Diff)

### Add
- Purchase confirmation dialog/modal that appears before any fund deduction
- Confirmation must show item name, price, current balance, and card info
- User must explicitly confirm or cancel before the charge goes through

### Modify
- `FacilityMenu` handlePurchase: intercept click, show confirm dialog, only deduct on confirm
- `PersonalFundManagement` handlePurchase: same intercept pattern

### Remove
- Nothing removed

## Implementation Plan
1. Add a `PurchaseConfirmModal` component (inline overlay) showing item name, cost, card last 4 digits, and current balance
2. In `FacilityMenu`, add pending purchase state; on PURCHASE click show modal, on confirm execute deduction, on cancel dismiss
3. In `PersonalFundManagement`, same pattern — show modal on submit, confirm to execute
4. Modal styled in XUTION aesthetic (gold border, dark bg, monospace font)
