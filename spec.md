# XUTION Portal

## Current State
The app is a full-stack real-time operations portal. Authentication currently supports username+security answer login, plus a QR scanner that fills in the username field but still requires the security answer. The QR management in Sovereign Database only stores an imported ID card image (arbitrary image file) per member -- there is no machine-readable QR token.

The `memberExtras` backend API (`setMemberExtras`, `getMemberExtras`, `getAllMemberExtras`) exists and stores arbitrary JSON per member.

A `useQRScanner` hook is already imported and used in `QRLoginScanner`.

## Requested Changes (Diff)

### Add
- QR token-based direct login: when the camera QR scanner reads a valid XUTION QR code (containing `{"xution_qr_token": "TOKEN", "username": "NAME"}`), look up the token against all memberExtras records and auto-login the matching member without requiring a password/security answer
- In Sovereign Database (L6 only), add a "GENERATE QR" button per member that creates a unique random token, saves it as `{"qrToken": "TOKEN"}` in that member's `memberExtras` via the backend, and displays a QR code image (generated client-side) encoding `{"xution_qr_token": "TOKEN", "username": "NAME"}`; also show a "DOWNLOAD QR" button to export the QR image as PNG
- Load the `qrcode` npm package (install via `npm add qrcode` and `npm add -D @types/qrcode` in the frontend) to generate QR code images client-side

### Modify
- `QRLoginScanner` `onScan` callback in `AuthScreen`: instead of just filling in the username field, attempt to parse `xution_qr_token` from the scanned data, look it up in all memberExtras (via backend `getAllMemberExtras`), find the matching member, fetch their full record via `loginUser` by fetching all users (`getAllUsers`) and finding the matching name, then call `onLogin` directly. Also keep the existing username fallback path for backward compatibility.
- The QR panel in Sovereign Database currently shows import/export of an ID card image. Keep the import/export of ID card images but add the QR token generation/display above it as a separate feature.

### Remove
- Nothing removed

## Implementation Plan
1. Install `qrcode` and `@types/qrcode` in `src/frontend/`
2. In `AuthScreen`, add a `handleQRLogin(data: string)` async function that:
   - Parses the scanned QR data as JSON
   - If it has `xution_qr_token`: calls `actor.getAllMemberExtras()`, finds matching member, fetches their full record via `getAllUsers()`, then calls `onLogin` with their data and marks as online (or falls back to localStorage if backend offline)
   - Falls back to the existing username fill-in behavior if no token found
3. Pass `handleQRLogin` as the `onScan` prop to `QRLoginScanner` (instead of the current username-only handler)
4. In the Sovereign Database QR panel section (around line 10195), above the existing ID card import/export, add:
   - A "GENERATE QR TOKEN" button that calls `actor.setMemberExtras(name, JSON.stringify({qrToken: randomToken, ...existingExtras}))` then renders a QR code using the `qrcode` package
   - Display the generated QR code as an `<img>` with a canvas-based data URL
   - A "DOWNLOAD QR" button to save the QR image
5. Ensure all real-time polling intervals remain intact (they already exist)
