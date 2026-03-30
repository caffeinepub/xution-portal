# XUTION Portal

## Current State
The Sovereign Database allows L6 to edit username, security question, and security answer for any member. Changes are saved to localStorage (L6's device) and partially synced to the backend. However:
- The 5s member poll adds new/renamed users but never removes old entries — deleted or renamed users persist in other devices' localStorage
- When username changes (BOB → BOBBY), the old memberExtras (profile photo, card image, QR data) stored under `BOB` key in the backend are NOT migrated to `BOBBY`
- Security question updates are only saved to localStorage; no backend call for the question means other devices don't pick up the changed question
- Member directory on other devices still shows stale usernames after a rename until a hard refresh

## Requested Changes (Diff)

### Add
- When the poll reconciles `getAllUsers()`, build a Set of valid backend names and remove any localStorage DB entries that no longer exist in the backend (except the currently logged-in user, to avoid self-eviction)
- On username rename in handleSaveCredentials: copy memberExtras from old name to new name in backend, then delete old name's extras — preserving profile photo, card image, QR data
- On credential save (question change without rename): store updated question in memberExtras JSON under key `q` so other devices can read and display it
- Poll should also sync the question from memberExtras into localStorage so the security question is current across devices

### Modify
- `handleSaveCredentials`: after renaming, call `setMemberExtras(newName, ...)` with migrated data and `setMemberExtras(oldName, '{}')` to clear old extras; also persist updated question into extras for non-rename case
- Member poll useEffect: after building the updated db from allUsers, remove any db keys not present in the backend's allUsers set (excluding currentUser.name); also pull question from memberExtras if available
- Also pull the allMemberExtras in the poll so profile photos and questions stay in sync across devices

### Remove
- Nothing removed

## Implementation Plan
1. In the member poll, after processing allUsers into db: build a Set of backend names, iterate db keys and delete any not in the set (skip currentUser.name)
2. Also fetch allMemberExtras in the poll; for each member parse extras JSON and if it has a `q` field, update db[name].q from it
3. In handleSaveCredentials (rename path): read old member's extras, write them to new name, clear old name's extras
4. In handleSaveCredentials (both rename and non-rename): store updated question in memberExtras JSON merged with existing extras
5. After credential save, call `refresh()` and `onUpdate()` so the directory immediately re-renders on the same device
