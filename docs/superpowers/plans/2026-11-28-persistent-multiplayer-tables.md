# Persistent Multiplayer Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multiplayer code joins account-only, reliable, and persistent while keeping guest solo play available.

**Architecture:** Keep one stable table code per Firebase account and one persistent Realtime Database room per table code and level. Use callable functions to validate accounts and codes, create or reopen boards, and write verified completion history; allow current table members to manage a board without the owner online.

**Tech Stack:** React 19, Vite, Firebase Authentication, Realtime Database, Firestore, Firebase Cloud Functions, Node.js built-in test runner, CSS theme variables.

**Spec:** `docs/superpowers/specs/2026-11-28-persistent-multiplayer-tables-design.md`

## Global Constraints

- Require a signed-in, non-anonymous account to create or join multiplayer tables, share room codes, and use the Together area.
- Explain the account requirement when a guest or signed-out player attempts a multiplayer action; offer sign-in without blocking solo play.
- Give each account a stable table code stored in Firebase, and let a player copy or enter a six-character code.
- Keep one persistent board per table code and puzzle level. Joining the same code and level restores saved progress without depending on the original host being online.
- Save verified shared completions to the table history.
- Make code, join, loading, and error states clear, keyboard-accessible, and responsive in light and dark themes.
- Preserve the current React/Vite and Firebase stack, product palette, and uncommitted work.
- Do not deploy Firebase functions or rules.

## Review Focus

- Anonymous users must not join shared or invite rooms; test account classification and guest-owned room rejection in Task 1 and Task 2.
- Invalid or colliding codes must not create duplicate tables; test normalization and collision-safe seat/code helpers in Task 1 and callable validation in Task 2.
- The two-player limit applies per table-and-level room, and stale presence must free a seat; test seat reservation and stale-player cleanup in Task 1.
- A signed-in member must initialize, continue, pause, complete, and explicitly restart a board while the owner is absent; test room-member authorization helpers in Task 1 and inspect rules/service paths in Task 3.
- Duplicate completion calls for one session must produce one shared history entry with accurate player attribution; test the history key in Task 1 and function transaction behavior in Task 3.

---

### Task 1: Shared-table helpers and regression tests

**Files:**
- Create: `src/utils/sharedTable.js`
- Create: `functions/sharedTableLogic.js`
- Create: `tests/sharedTable.test.js`
- Modify: `package.json`
- Modify: `src/services/roomService.js` to use and export the shared-table helpers

**Interfaces:**
- `normalizeTableCode(value) -> string | null`: uppercase and validate exactly six unambiguous characters.
- `canPlayMultiplayer(user) -> boolean`: true only for a user with a UID who is neither anonymous nor a local guest.
- `sharedLevelRoomId(code, levelId, prefix) -> string`: stable client room ID for a valid table code and level.
- `sharedTableCodeFromRoomId(roomId, prefix) -> string | null` and `isSharedRoomId(roomId, prefix) -> boolean`: parse the same room-ID format.
- `isAccountAuth(auth) -> boolean`, `sharedRoomId(code, levelId) -> string`, `reserveSharedSeat(players, player, now, limit, staleMs) -> object | null`, and `sharedHistoryId(roomId, sessionId) -> string` in the function-only helper module.

- [ ] **Step 1: Write failing tests** for code normalization, anonymous/guest denial, client/server room-ID parity, shared-room detection, concurrent seat capacity, stale-seat recovery, and stable history IDs.
- [ ] **Step 2: Run `npm test` and confirm the missing or incorrect shared-table behavior fails.** Expected: failures name the unimplemented helpers or the current room-ID mismatch.
- [ ] **Step 3: Implement the minimal pure helpers** and re-export client helpers from `roomService.js`.
- [ ] **Step 4: Run the focused test file and confirm all helper tests pass.**
- [ ] **Step 5: Add `npm test` as `node --test tests/*.test.js`.**

### Task 2: Account registry and secure Firebase entry

**Files:**
- Modify: `functions/index.js`
- Modify: `database.rules.json`
- Modify: `src/services/roomService.js`
- Modify: `src/services/firebase.js` only if callable arguments or results require an adapter
- Test: `tests/sharedTable.test.js`

**Interfaces:**
- Add callable `joinSharedTable({ code, levelId, displayName }) -> { id, meta, game, player }`.
- Add client service functions `getUserTableCode(user)`, `saveUserTableCode(code, user)`, `registerTable(code, user)`, and `tableExists(code)`.
- Use Realtime Database paths `/tableCodes/{code}`, `/userTables/{uid}`, and `/tableHistory/{code}/{historyId}`.
- Register new normal rooms with `meta.multiplayerEnabled` set from account type.

- [ ] **Step 1: Add failing function-helper tests** for anonymous callable identity, matching client/server room IDs, two active seats, one stale seat, and stable completion IDs.
- [ ] **Step 2: Run `npm test -- --test-name-pattern="account|seat|history|room ID"` and confirm expected failures.**
- [ ] **Step 3: Implement `joinSharedTable`.** It must reject anonymous identities, validate the registered code and level ID, create a missing permanent room, atomically reserve at most two current seats, restore existing state, and persist the user's selected code.
- [ ] **Step 4: Add narrow database rules** for account-only code registration/read, account-owned `/userTables`, member-only shared game changes, and read-only `/tableHistory`.
- [ ] **Step 5: Run `node --check functions/index.js` and `npm test`; confirm syntax and helper tests pass.**

### Task 3: Join, host-independent board control, and verified history

**Files:**
- Modify: `src/services/roomService.js`
- Modify: `src/hooks/useRoom.js`
- Modify: `functions/index.js`
- Modify: `database.rules.json`
- Test: `tests/sharedTable.test.js`

**Interfaces:**
- `enterSharedRoom({ user, displayName, levelId, code })` delegates online membership to `joinSharedTable` and registers disconnect cleanup after membership succeeds.
- `joinRoom({ code, user, displayName, resumeOwned })` uses the existing callable for multiplayer; `resumeOwned` is allowed for a guest only when reopening that guest's own solo room.
- `recordSharedCompletion(...)` calls the existing validated `recordPuzzleCompletion` callable online and writes a deduplicated local record only in local mode.

- [ ] **Step 1: Write failing tests** for signed-in room-code joins, guest-owned room rejection, own-solo-room restoration, persistent table membership, and duplicate history IDs.
- [ ] **Step 2: Run the focused tests and confirm each failure matches the missing behavior.**
- [ ] **Step 3: Route normal Firebase room-code joins through `joinRoom`; reject anonymous joiners and guest-owned multiplayer rooms while preserving owner-only guest solo restore.**
- [ ] **Step 4: Let permanent shared members initialize, update status, move pieces, and explicitly reset their own level board; skip host transfer for permanent table rooms.**
- [ ] **Step 5: Extend `recordPuzzleCompletion` to write one validated `/tableHistory/{code}/{roomId_sessionId}` entry. Read table history from that path and preserve player attribution from placed pieces and participants.**
- [ ] **Step 6: Run the focused tests and `node --check functions/index.js`; inspect that room state remains when players leave.**

### Task 4: Auth feedback, account persistence, and route recovery

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/pages/HomePage.jsx` if the multiplayer entry copy needs an account hint
- Modify: `src/components/AuthDialog.jsx` only if a pending action needs to be surfaced
- Test: `tests/sharedTable.test.js`

- [ ] **Step 1: Add failing tests** for account-only multiplayer action guards and legacy local-code migration decisions.
- [ ] **Step 2: Run tests and confirm the missing guard/persistence behavior fails.**
- [ ] **Step 3: Load table code from `/userTables/{uid}`; register and save one if absent; migrate a valid legacy local code when it remains available.**
- [ ] **Step 4: Preserve an incoming room code while prompting for sign-in; retry the join after a real account signs in.**
- [ ] **Step 5: Gate Together navigation, room creation for invitations, room sharing, and all code joins. Keep `Play now` and guest-owned puzzle restore available.**
- [ ] **Step 6: Run the focused tests and confirm guest attempts produce clear sign-in feedback.**

### Task 5: Together-page code states and responsive styles

**Files:**
- Modify: `src/pages/TogetherPage.jsx`
- Modify: `src/css/pages/TogetherPage.css`
- Modify: `src/App.jsx` to provide loading, failure, and retry state
- Test: `tests/sharedTable.test.js`

- [ ] **Step 1: Add a failing helper test** for six-character code input normalization and clipboard fallback selection state.
- [ ] **Step 2: Run the focused test and confirm invalid codes or missing clipboard support are handled incorrectly.**
- [ ] **Step 3: Show table-code loading and setup failures; add retry behavior and inline join errors.**
- [ ] **Step 4: Copy with `navigator.clipboard` and fall back to selectable text with explicit success/failure feedback.**
- [ ] **Step 5: Style code panels and inputs with existing theme variables; keep keyboard focus, readable errors, touch targets, and 320px layouts.**
- [ ] **Step 6: Run the focused tests and visually inspect the Together page at desktop and mobile widths.**

### Task 6: Final verification and diff review

**Files:**
- Review: all changed app, function, rule, test, and design files

- [ ] **Step 1: Run `npm test` and record the full result.**
- [ ] **Step 2: Run `npm.cmd run build` and record the exit code.**
- [ ] **Step 3: Run `npm.cmd run lint`; fix issues in the multiplayer changes and report unrelated pre-existing failures by file and rule.**
- [ ] **Step 4: Validate `database.rules.json` with `node -e "JSON.parse(require('node:fs').readFileSync('database.rules.json','utf8'))"`.**
- [ ] **Step 5: Review `git diff --check`, changed paths, and the final acceptance checklist. Do not stage or commit pre-existing worktree changes.**

