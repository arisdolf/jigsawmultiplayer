# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React with Vite, Tailwind CSS, Lucide React, Firebase Authentication, Firestore, Realtime Database, and Cloud Storage.

## Users

Friends and small groups who want to relax and solve a shared jigsaw puzzle together on desktop, tablet, or mobile.

## Product Purpose

JigsawMult lets players meet in a room and collaborate on the same configurable jigsaw puzzle in real time.

## Positioning

Every player manipulates one shared puzzle board, with piece movement and completion state synchronized for the whole room.

## Operating Context

Players create or join a room, choose a level, solve together, chat, and track completion. Hosts manage room settings and game state. Administrators configure and publish levels.

## Capabilities and Constraints

- Exactly 10 independently configurable levels, with default piece counts 25, 50, 100, 200, 300, 500, 750, 1,000, 2,500, and 5,000.
- Levels store their image, title, description, difficulty, order, availability, lock state, and completion requirements in Firebase.
- Room state, piece movement, placement, progress, presence, chat, and completion records persist through Firebase.
- Authentication supports email/password, Google, and guest access.
- Puzzle geometry needs at least six complementary interlocking edge styles and must support mouse and touch input.
- Audio includes separate persistent music and sound-effect controls. No licensed audio assets were supplied.
- Firebase project configuration and administrator claims are not yet available; keep credentials in environment configuration and enforce admin access in Firebase rules.
- Do not invent player statistics, completion records, licensing claims, or testimonials.

## Brand Commitments

The product name is JigsawMult. The interface should feel cozy, relaxing, welcoming, and playful. Use cozy blue `#527FA8`, deep blue `#294C70`, warm red `#D96868`, soft blue-gray `#EAF1F7`, warm white `#FAFCFF`, muted coral, dusty blue, and soft beige.

## Product Principles

- Keep the shared puzzle as the main focus.
- Make multiplayer presence and progress easy to read.
- Make level content configurable without frontend source edits.
- Keep controls comfortable on touch screens and usable by keyboard.
- Keep background audio gentle and individually controllable.
