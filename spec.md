# XUTION Portal

## Current State
Full-stack XUTION portal with authentication, member management, facilities, sector logs, admin posts, fund/card system, and a DM system. The DM system consists of:
- `DMPanel`: floating chat window (text-only send, no attachments)
- `DMInboxOverlay`: inbox list with search by member name
- `DMMessage` type: `{ from, text, ts }`
- No search within message history
- No attachment support

## Requested Changes (Diff)

### Add
- Message search bar inside `DMPanel` — filters visible messages by keyword
- Attachment toolbar in `DMPanel` with buttons for: image upload, file/document upload, video upload, audio upload, GIF (via URL/picker), custom emoji picker, and voice message recording
- Rich message rendering: images inline, video inline with controls, audio player, file download link, voice message waveform/player, GIF inline, emoji display
- `DMMessage.attachments` array: `{ type: 'image'|'video'|'audio'|'file'|'gif'|'voice', dataUrl?: string, url?: string, name?: string, mimeType?: string }`
- Voice message recording via `MediaRecorder` API with a hold-to-record button
- Custom emoji picker panel (a grid of Unicode emoji categories)
- GIF input (paste URL) panel
- Update `DMInboxOverlay` last-message preview to show attachment type label when message has no text (e.g. "📎 IMAGE", "🎤 VOICE MESSAGE")

### Modify
- `DMMessage` type: add optional `attachments` field
- `getDMs` / `addDM` helpers: update to support the new `attachments` field
- `DMPanel` input area: replace simple text row with rich toolbar + input row

### Remove
- Nothing removed

## Implementation Plan
1. Update `DMMessage` interface to include optional `attachments: DMAttachment[]`
2. Update `getDMs`/`addDM` to pass through attachments
3. Upgrade `DMPanel`:
   - Add `searchQuery` state and filter messages
   - Add search bar above message list (collapsible or always visible toggle)
   - Replace bottom input row with a two-row layout: toolbar row + text+send row
   - Toolbar buttons: 📎 Image, 📁 File, 🎬 Video, 🎵 Audio, 🌀 GIF, 😊 Emoji, 🎤 Voice
   - Each opens a sub-panel or triggers a file input
   - Voice: hold button → MediaRecorder records → release → attaches blob as dataUrl
   - Emoji: small grid panel of common Unicode emoji
   - GIF: text input for URL
   - File inputs: hidden `<input type="file">` refs for each type
   - Rich rendering for each attachment type in the message bubble
4. Update `DMInboxOverlay` preview text to handle attachments
