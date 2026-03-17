# XUTION Portal

## Current State
- QR code login exists on the login screen but uses a text input — no real camera scanning
- Any user can upload a QR image to their ID card (ID_LINK section)
- Sovereign Database shows member list with level controls for L6 only
- No QR code generation, assignment, or export per member in Sovereign Database

## Requested Changes (Diff)

### Add
- Real camera-based QR code scanner on login screen using `useQRScanner` hook
- In Sovereign Database (admin panel, L6 only): per-member QR code management section
  - Generate a QR code for each member (encoding their username as JSON: `{"username":"NAME"}`)
  - Display the generated QR as a scannable image using the `qrserver.com` API
  - Export/download QR code image per member
  - L6 can also update (regenerate) the QR for any member
  - Store assigned QR data per member in localStorage keyed by member name

### Modify
- Login screen QR section: replace the plain text paste box with a live camera scanner (using `useQRScanner`). Retain manual text fallback.
- Sovereign Database member rows: add a collapsible QR sub-panel (L6 only) with generate/view/export controls
- Remove the QR upload section from the ID card (ID_LINK) since QR management is now L6-only via Sovereign Database

### Remove
- QR image upload button from the ID card/ID_LINK section (any user could previously upload their own QR)

## Implementation Plan
1. Create a `QRLoginScanner` component using `useQRScanner` that renders a camera preview + canvas, auto-fills the username on scan, and shows a manual text fallback
2. Integrate `QRLoginScanner` into the login screen replacing the current QR text input flow
3. In the Sovereign Database section (inside AdminPanel, L6 only), add a per-member collapsible QR block:
   - A "GENERATE QR" button that sets a localStorage key `x_qr_assigned_<memberName>` to `{"username":"<memberName>"}`
   - Renders the QR image via `qrserver.com` API
   - An "EXPORT" button that opens the QR image URL in a new tab (or triggers download)
4. Remove the QR image upload controls from the ID_LINK/App component
