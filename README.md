# JigsawMult

Cozy shared jigsaw rooms built with React, Vite, Tailwind CSS, Lucide, and Firebase.

## Run locally

```powershell
npm install
npm run dev
```

Use Node.js 22 for local development and Functions deployment.

Without Firebase credentials, development uses ten seeded puzzle records, browser local storage, and BroadcastChannel for collaboration between tabs. Each tab gets its own guest identity. Cloud accounts, image uploads, cross-device rooms, and protected publishing need Firebase setup.

## Firebase setup

1. Copy `.env.example` to `.env.local`. Copy Web App values from Firebase Console. Keep service-account JSON out of the repository.
2. Enable Email/Password, Google, and Anonymous sign-in in Firebase Authentication.
3. Create Cloud Firestore, Realtime Database, and Firebase Storage.
4. Set `FIREBASE_SERVICE_ACCOUNT_PATH` and `FIREBASE_ADMIN_UID` in `.env.local`. Use a service account with Firebase Admin permissions.
5. Install Cloud Functions dependencies: `npm --prefix functions install`.
6. Sign in to Firebase CLI and select the project: `npx firebase-tools login`, then `npx firebase-tools use --add`.
7. Seed the ten editable levels and grant the admin claim: `npm run seed:firebase`.
8. Reauthenticate after setting the claim. Admin access comes from the signed Firebase token.
9. Deploy database rules, Firestore rules, Storage rules, and the completion function:

```powershell
npx firebase-tools deploy --only database,firestore:rules,storage,functions
```

10. Start the web app: `npm run dev`.

Firebase Web App values use the `VITE_FIREBASE_*` names in `.env.example`. Copy the exact Realtime Database URL and Storage bucket from Firebase Console. Do not commit `.env.local` or a service-account JSON file.

## Puzzle library

`scripts/levels.seed.json` seeds exactly ten levels. Piece counts default to 25, 50, 100, 200, 300, 500, 750, 1,000, 2,500, and 5,000. Firebase stores editable titles, descriptions, image URLs, difficulty, piece count, visibility, lock state, rotation, and completion requirements. The Studio panel writes level edits to Firestore and puzzle images to Storage.

Puzzle geometry creates six complementary edge profiles. A canvas crops one source image for all pieces. Generation yields in batches; viewport queries draw visible pieces only. Pointer locks and piece changes use per-piece Realtime Database paths. The 5,000-piece level avoids separate image files.

## Firebase layout

- `users/{uid}` stores editable profile fields and server-written statistics.
- `levels/{levelId}` stores the ten level configurations.
- `rooms/{roomId}` stores room metadata, members, game timing, piece state, targets, and chat.
- `roomCodes/{code}` maps a share code to a room.
- `completions/{roomId_sessionId}` stores verified room results.
- `users/{uid}/completions/{levelId}` stores player progress.
- `puzzles/{levelId}/{fileName}` stores uploaded images.

Rules deny root access by default. Room hosts control settings and game state. Firebase transactions reserve piece locks. A callable Cloud Function checks completed room state before writing progress and statistics.

## Audio

The app synthesizes soft background tones and placement effects with the Web Audio API. Music and effect volumes are separate and saved per browser.
