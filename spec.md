# XUTION Portal

## Current State
App.tsx (~14,689 lines) has full DM system with private and group chats. GIFs are rendered using `<img>` with `crossOrigin="anonymous"` and `referrerPolicy="no-referrer"` which causes CORS failures that trigger a fallback `[View GIF]` link. Neither private DMs nor group DMs have video or voice calling.

## Requested Changes (Diff)

### Add
- Video and voice call buttons in every DM chat header (both private DMPanel and GroupChatPanel)
- A call overlay/modal that captures local camera/mic, shows local + placeholder remote video, and can be dismissed
- Call state management: offer outgoing call, show incoming call notification to the recipient via backend polling

### Modify
- GIF `<img>` rendering in `renderAttachment` (both DMPanel ~line 3595 and GroupChatPanel ~line 11390): remove `crossOrigin="anonymous"` and `referrerPolicy="no-referrer"` attributes that trigger CORS preflight failures. For Tenor share page URLs (`tenor.com/view/...`), convert to embed URL or show as iframe. For all other direct URLs (ending in .gif/.webp/.mp4), just render as `<img>` without CORS attributes so the browser loads them normally.
- Staging area GIF preview (the 32x32 thumbnail at ~line 3985) — same CORS attr fix.

### Remove
- Nothing removed

## Implementation Plan
1. In both `DMPanel.renderAttachment` and `GroupChatPanel.renderAttachment`: remove `crossOrigin` and `referrerPolicy` from GIF img tags. Add a helper that detects Tenor page URLs (`tenor.com/view/`) and converts them to `tenor.com/embed/ID` rendered in an `<iframe style="width:100%;height:180px;border:none">`, otherwise render as `<img>`. Keep the `onError` fallback link for anything that still fails.
2. Fix the 32x32 staging thumbnail GIF img tags the same way.
3. Add 📞 (voice) and 📹 (video) icon buttons to the DMPanel header and GroupChatPanel header.
4. Create a `CallOverlay` component (or inline in App.tsx) that: requests getUserMedia (video+audio for video call, audio-only for voice), shows a local video element, displays "CALLING..." status, and has a hang-up button that stops tracks and closes overlay. Show an incoming call banner when another user is calling (poll backend or localStorage call state key every 3 seconds).
5. Wire call state through localStorage (keyed by conversation id) for simple cross-tab signaling, since full WebRTC ICE signaling via backend is out of scope. This at least enables same-device demo and shows the correct UI.
