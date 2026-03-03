# XUTION Portal

## Current State
The app has a dual-mode auth system: it tries the backend canister first, falls back to localStorage if offline. After login, there is no visible indicator of whether the user is in ONLINE or OFFLINE mode. The "OFFLINE MODE" text only briefly appears on the auth screen during login and disappears.

User data (level, question, answer, uid) is cached in localStorage after a successful online login. The backend canister stores the authoritative user data. However, after login, no polling or re-sync of user info happens -- changes made on another device online won't update the current session.

## Requested Changes (Diff)

### Add
- A persistent ONLINE / OFFLINE mode badge visible on the ID card / HUD after login. 
  - ONLINE: green indicator (e.g. "● ONLINE") shown when the canister is reachable.
  - OFFLINE: blue/amber indicator (e.g. "⚡ OFFLINE MODE") when falling back to local cache.
- Pass the online/offline mode status from the `AuthScreen` login result up to the `App` component and display it persistently.
- A periodic sync (every 30s) that re-checks if the canister is reachable after an offline login; if it comes back online, it re-fetches the user's latest data and updates both the React state and the localStorage cache, and flips the indicator to ONLINE.
- When a user logs in online, their current data (level) is fetched from the backend and used to update the local cache so both stay in sync.

### Modify
- `AuthScreen` `onLogin` callback: add an `isOnline: boolean` flag to the login result object passed back up to `App`.
- `App` `handleLogin`: accept and store the `isOnline` flag in state.
- ID card HUD box: render the ONLINE/OFFLINE badge below the user's level indicator.
- `MemberList` `changeLvl` and `delMem`: after performing the local change, also call the backend canister to keep it in sync (fire-and-forget, ignore errors so offline still works).

### Remove
- Nothing removed.

## Implementation Plan
1. Add `isOnline: boolean` to the `CurrentUser` or as separate state in `App`.
2. Modify `AuthScreen` `onLogin` to pass `isOnline` flag: online=true when backend login/register succeeded, false on fallback.
3. In `App.handleLogin`, store `isOnline` in a `useState<boolean>` and display it in the HUD ID box.
4. Add a `useEffect` in `App` that runs every 30 seconds after login: attempts `actor.loginUser` with cached credentials; if it succeeds, update user level from backend, update localStorage, flip isOnline to true; if it fails and we're online, keep the state.
5. In `MemberList.changeLvl`: after updating localStorage, fire `actor.updateUserLevel(name, BigInt(newLvl))` in the background.
6. In `MemberList.delMem`: after deleting from localStorage, fire `actor.deleteUser(name)` in the background.
7. Display badge in HUD: green "● ONLINE" or blue "⚡ OFFLINE" inline below user level in the ID box.
