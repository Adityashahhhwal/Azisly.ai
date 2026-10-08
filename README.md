# AptiQuiz

Real-time multiplayer aptitude practice for campus placements. Up to 50 students join a room, answer shared timed questions, and compete on a live leaderboard.

## Problem
Students often practise aptitude from PDFs, but placement tests also demand speed and pressure-handling. AptiQuiz turns preparation into a fair, replayable room-based game for students and a measurable practice tool for colleges.

## Core flow
1. Host creates or reuses a question set.
2. Host creates a room and shares a short code.
3. Players join from phone or laptop.
4. The server starts each question and owns the deadline.
5. Players answer; the server validates and scores submissions.
6. Correct answers and round results are revealed.
7. Leaderboard movement appears after every round.
8. Final results show accuracy, average speed and topic strengths.
9. Completed rooms contribute to a college league.

## Monorepo
```text
apps/web                 player, host, spectator and results UI
apps/server              HTTP API, WebSocket gateway and game engine
packages/contracts       shared schemas and event payloads
packages/game-rules      scoring and state transitions
packages/ui              accessible shared UI primitives
packages/config          shared workspace configuration
scripts/simulate-50-players required load simulation
docs                     rules, brainstorm, architecture and load-test docs
```

## Scoring
Correct answers receive points based on server-observed response speed. Wrong, unanswered, duplicate and late submissions receive zero. The browser never decides time, correctness or score. Exact constants are visible before a game starts.

## Fairness
The server starts and ends every round and records answer arrival. Browser clocks and client timestamps are not trusted. A rolling, capped server-measured latency adjustment may reduce network-delay unfairness but cannot make an answer after the actual server deadline valid.

## Reconnection
A player receives a session token. Reconnection restores identity, score, answered state and the current server snapshot without pausing or resetting the room.

## Host rooms, custom questions and teams

Every `POST /rooms` request receives a unique six-character room PIN and a private `hostToken`. The PIN is safe to share with contestants; the host token is stored only by the host client and is required to start the room. This prevents a second host or player from accidentally controlling another contest.

The room request can set `teamMode: true`, provide teams such as `[{ "name": "Red Team" }, { "name": "Blue Team" }]`, and include `customQuestions`. Custom questions use the shared `Question` shape (`text`, `options`, `correctOptionId`, `topic`, `difficulty`, and optional `timeLimitMs`). They are validated on the server and can be combined with the supplied booklet starter set. Team membership is selected with a team ID such as `team-1`; individual and team leaderboards are broadcast in every snapshot.

## Cheating resistance
Options are shuffled per player; correct answers are withheld until the round closes; only the current question is sent; room/player/question identity is validated; late and duplicate submissions are rejected; client scores and timestamps are ignored.

## Adaptive practice and analytics

The server tracks accuracy, response time and topic performance per player. After enough answers, it adjusts a server-owned difficulty signal and sends a small explanation such as “Difficulty increased”; the browser cannot choose difficulty or score. Snapshots include accuracy, average response time, correct/incorrect counts, topic strengths and weaknesses, recommendations and a 0-100 placement-readiness score.

The dashboard includes post-quiz insights, performance radar-style visualization, speed-versus-accuracy metrics, earned badges, a host analytics endpoint (`GET /rooms/:id/analytics` with `x-host-token`), an AI-assisted draft generator (`POST /question-generator`), and a college league endpoint (`GET /league?period=weekly|monthly|all-time`). The current generator is deliberately deterministic and review-first so no external API key is needed; it can be replaced by an LLM provider behind the same endpoint.

When enabled, the final three questions are marked as a Clutch Round. The server applies a 1.5x correct-answer multiplier, and the client displays the rule without controlling it.

## Status

The responsive React product now includes the live player flow plus dashboard navigation for Practice, AI Generator, Analytics, Leaderboard, College League, Achievements and Profile. It keeps the server-issued session and host tokens in local storage for reconnection and host control. Persistent database storage, a richer host moderation workflow and the 50-player simulator remain before deployment.

Run the server with `npm run dev:server`, then run the web app with `npm run dev --workspace @aptiquiz/web`. Set `VITE_API_URL` and `VITE_WS_URL` when the server is not on `localhost:3001`.

## Seed question set

The first demo set uses reviewed questions adapted from the supplied `Aptitude and Reasoning Booklet 2026.pdf`, covering quantitative, logical, verbal and data-interpretation practice. The server-side set is exported from `packages/contracts/src/seed.ts`; provenance and answer-key notes are recorded in [docs/QUESTION-SOURCE.md](docs/QUESTION-SOURCE.md).

## Local server

Run `npm run dev:server` to start the current HTTP/WebSocket server. `GET /health` verifies the process. The API is intentionally in-memory at this stage; no database or external API key is required. The desktop web client can create a demo room, enable team mode, and paste validated custom-question JSON.

## Progress tracking

Implementation status is tracked in [docs/PROGRESS.md](docs/PROGRESS.md) so each phase remains traceable to the existing contracts and source material.

## Required documentation
- PROJECT-RULES.md
- BRAINSTORM.md
- ARCHITECTURE.md
- LOAD-TEST.md