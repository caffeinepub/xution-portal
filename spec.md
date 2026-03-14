# XUTION Portal

## Current State
The Contact Command pill is a fixed `<a href="mailto:Gameloverv@gmail.com">` element with a hardcoded email address. There is no way for L6 admins to change this link.

## Requested Changes (Diff)

### Add
- A `CONTACT COMMAND` section in `AdminSettingsPanel` (for L6 only) with:
  - A label/header styled like other admin sections.
  - A text input pre-filled with the current contact URL/email.
  - A save button that persists the new value to `localStorage` under key `x_contact_link`.
- A helper `getContactLink()` that reads `localStorage.getItem('x_contact_link')` and falls back to `'mailto:Gameloverv@gmail.com'`.

### Modify
- The Contact Pill `<a>` element's `href` should use `getContactLink()` instead of the hardcoded `mailto:Gameloverv@gmail.com`.
- The Contact Pill should also re-render when the contact link is updated (use React state initialized from `getContactLink()` and updated on save).

### Remove
- Nothing removed.

## Implementation Plan
1. Add `getContactLink()` helper near other `getAboutContent` helpers.
2. Add `contactLink` state in the main `App` component, initialized from `getContactLink()`.
3. Pass `contactLink` and a setter/callback `onContactLinkChange` to `AdminSettingsPanel`.
4. In `AdminSettingsPanel`, add a `CONTACT COMMAND` section with an input and save button. On save, write to localStorage, call `onContactLinkChange`, and show a brief confirmation.
5. Update the Contact Pill `href` to use `contactLink` state.
