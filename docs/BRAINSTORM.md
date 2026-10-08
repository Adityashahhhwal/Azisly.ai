# AptiQuiz Brainstorm and Execution Plan

## Product thesis
Students need practice under pressure, not only a list of questions. AptiQuiz makes speed, accuracy and competition part of the learning loop.

## Primary users
- Students preparing for campus placements.
- Faculty and placement cells running practice events.

## MVP
1. Question authoring: add, edit, reorder, duplicate and reuse.
2. Room creation and short-code lobby.
3. Server-controlled timed gameplay.
4. Positive speed-and-accuracy scoring.
5. Round results and leaderboard movement.
6. Reconnection with preserved score.
7. Final accuracy, speed and topic analysis.
8. Basic college league.
9. Faculty insight: most-missed questions and topic performance.
10. 50-player simulator with recorded results.

## Defer
Team battles, power-ups, adaptive difficulty, daily streaks and spectator mode. They are useful extensions but risk the core delivery.

## Recommended demo
Use a five-question placement set. Host creates a room, several players join, two rounds demonstrate speed scoring and leaderboard movement, one player refreshes to demonstrate recovery, then the host opens topic analytics.

## 16-hour sequence
- 0-2: monorepo, health endpoints, deployment path, environment safety.
- 2-4: explicit game state machine and shared event contracts.
- 4-6: room creation, join code, lobby and host start.
- 6-9: question broadcast, deadline, answer validation and scoring.
- 9-11: leaderboard, movement and final results.
- 11-12: session tokens and reconnection snapshot.
- 12-13: question authoring and seeded demo set.
- 13-14: faculty insights.
- 14-15: 50-player simulator and measurements.
- 15-16: mobile checks, README, deployment, recording and rehearsal.

## Differentiator
Prioritize faculty insights over power-ups: most-missed questions, topic accuracy, difficulty performance and exportable results. This supports college adoption without adding risky game mechanics.

## Success criteria
A fresh player can join, answer a timed question, receive a server result, see leaderboard movement, refresh without losing score and understand the rules. The 50-player test is present and documented.