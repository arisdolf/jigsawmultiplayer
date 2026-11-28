# Persistent Multiplayer Tables Design

## Intent

Make code-based multiplayer reliable and keep a player's shared table available from their account after they leave or the original host goes offline. Guests can still solve puzzles solo.

## Goals

- Require a signed-in, non-anonymous account to create or join multiplayer tables, share room codes, and use the Together area.
- Explain the account requirement when a guest or signed-out player attempts a multiplayer action; offer sign-in without blocking solo play.
- Give each account a stable table code stored in Firebase, and let a player copy or enter a six-character code.
- Keep one persistent board per table code and puzzle level. Joining the same code and level restores saved progress without depending on the original host being online.
- Save verified shared completions to the table history.
- Make code, join, loading, and error states clear, keyboard-accessible, and responsive in light and dark themes.

## Non-goals

- Redesign account providers, level unlocking, audio, or puzzle mechanics.
- Change the normal solo-play experience for guests.
- Deploy Firebase functions or rules as part of this workspace change.
- Clean up unrelated pre-existing edits in the dirty worktree.

## Constraints

- Keep the existing React/Vite, Firebase Authentication, Realtime Database, Firestore, and Cloud Functions stack.
- Preserve the current app palette and CSS conventions; use its theme variables for new Together-page styling.
- Normal room creation also supports solo play, so guest-created rooms must not become joinable multiplayer rooms.
- Database rules must enforce the same account and membership restrictions as the UI and callable functions.
- The workspace already contains uncommitted changes in multiplayer and UI files. Preserve them and make narrow edits.

## Approaches

1. **Broaden direct Realtime Database rules.** Fewer backend changes, but clients would need wider access to shared metadata and room membership. This weakens code-based access checks.
2. **Use callable functions for multiplayer entry.** Functions validate account type and table code, create or reopen a level room, and add membership before clients subscribe. This is the chosen approach because it supports host-independent access while keeping database writes controlled.

## Design

- A pure shared-table helper owns code normalization, stable room-ID construction, and shared-room detection. Its format matches the client and function implementations.
- Realtime Database stores code ownership and each user's selected table code. A joined account's selected code updates only after successful membership; the code survives sign-out and another device.
- A callable joins a shared table. It rejects anonymous users, verifies that the table code is registered, creates a missing per-level room, restores existing game state, and reserves a seat transactionally. The table remains stored when players leave. Permanent shared-room members may update game state and initialize or reset a board without the table owner online.
- Normal code joins use the existing callable instead of reading private room metadata before membership. The function rejects anonymous joiners and guest-owned rooms. Guests may reopen only their own solo room.
- Completion saving uses the existing server-side puzzle validation and writes a table-history record. Clients read history for the registered code; clients cannot write history directly.
- Together-page controls show code setup and copy failures. Copy uses the Clipboard API with a selectable-code fallback. Join validation gives inline errors. Auth prompts preserve pending room links until sign-in completes.
- New styles use current light/dark theme variables, visible focus, readable status text, and touch-sized controls at narrow widths.

## Verification

- Add focused regression tests for shared-room IDs, code validation, and the account-only multiplayer rule.
- Check callable logic and database rules for guest rejection, valid-code membership, host-independent access, and persistent boards.
- Run the test suite, lint, and production build. Report pre-existing unrelated lint failures separately.
- Do not deploy Firebase changes; live multiplayer will use the new behavior after its functions and database rules are deployed.

## Builder decisions

- Keep the current two-player shared-table limit.
- Keep one selected table code per account, matching the current Together-page model.
- Generate a code once per account. Retry collisions; do not add code rotation. Migrate a valid legacy local code into the account mapping when possible.
- Apply the two-player limit to concurrent players in each table-and-level room. Leaving removes presence, not the table or its saved board; anyone with the code may rejoin.
- Let any current table member initialize or explicitly restart that level's board. Restart clears only that level's progress.
- Write one server-validated history record per room session, deduplicated by room ID and session ID, with attribution from placed pieces and room participants.
- Preserve existing solo rooms for their owners. Do not attach legacy global shared-room data to an account without a registered table code.
- Treat the table owner as record ownership, not as a required online host.
