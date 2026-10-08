# AptiQuiz Progress Tracker

Last updated: 2026-10-08.

## Audit log

### 2026-10-08 — full feature-path audit

- Added explicit `unanswered` round results so timed-out players appear in results without receiving score or analytics credit.
- Persisted room completion timestamps and made weekly/monthly college league queries filter completed rooms by the requested period.
- Prevented custom question IDs from colliding with IDs in the selected starter question set.
- Preserved built-in question sets when restoring persisted custom state.
- Made question-generator request failures visible in the web UI and ensured loading state always resets.
- Added regression tests for unanswered submissions and league period filtering.
- Verified with `npm run typecheck`, `npm run test:engine` (10 passing tests), and `npm run build --workspace @aptiquiz/web`.

## Completed

- [x] Confirm AptiQuiz / Problem Statement 3 as the selected product.
- [x] Create the monorepo documentation baseline.
- [x] Add README, project rules, brainstorm, architecture and load-test documents.
- [x] Add workspace TypeScript configuration and package boundaries.
- [x] Define shared question, room, player, answer, result and WebSocket contracts.
- [x] Add the supplied Aptitude and Reasoning Booklet 2026 starter question set.
- [x] Implement deterministic server-side scoring and leaderboard rules.
- [x] Protect public snapshots from exposing session tokens or answer keys.

## In progress

- [x] Implement the in-memory authoritative game engine.
- [x] Add room creation, player join and lobby transitions.
- [x] Add server-controlled question start, answer validation and round closure.
- [x] Add reconnection snapshots and player-specific option ordering.

## Next

- [x] Add HTTP and WebSocket transport in `apps/server`.
- [x] Add focused engine tests for timing, duplicates and reconnection. 50-player simulation remains next.
- [x] Build the desktop-first web player flow and connect it to HTTP/WebSocket transport.
- [x] Allocate unique room PINs and private host tokens, with host-only game start.
- [x] Support validated custom questions and optional team rooms with individual/team leaderboards.
- [x] Add server-authoritative adaptive difficulty signals, player analytics, readiness scoring and weakness recommendations.
- [x] Add clutch rounds, host analytics/export endpoint, AI-assisted question drafts and college league endpoint.
- [x] Add responsive dashboard navigation, post-quiz insights, badges and reconnection status UI.
- [x] Add regression coverage for cross-room session isolation, team analytics and adaptive difficulty.
- [x] Persist rooms, custom question sets, sessions, scores and host room credentials across server restarts.
- [ ] Build the host authoring and moderation interfaces.
- [ ] Optimize the player UI for phones after the desktop flow is stable.
- [ ] Add the 50-player simulator under `scripts/simulate-50-players`.
- [ ] Run and document measured load-test results.
- [ ] Deploy early and rehearse the three-minute demo.

## Working constraints

- No client clock or client score is authoritative.
- Correct answers stay in server-side question-set data.
- Public snapshots must not contain session tokens or canonical answer mappings.
- Changes must preserve the existing contracts and booklet source notes.