# AptiQuiz Architecture

## Components
- `apps/web`: player, host, results and future spectator views.
- `apps/server`: HTTP routes, WebSocket gateway, room manager, game engine, scoring, reconnection and league services.
- `packages/contracts`: request/response/event schemas.
- `packages/game-rules`: pure scoring and state-transition functions.
- `packages/ui`: shared accessible controls and leaderboard components.

## Game state
```text
LOBBY -> QUESTION_ACTIVE -> QUESTION_CLOSED -> ROUND_RESULTS -> LEADERBOARD
                                                       |              |
                                                       +--------------+
                                                        next question
LEADERBOARD -> GAME_COMPLETE
```

The server persists room state, question start/deadline, player sessions, submissions, scores and results. WebSocket events broadcast state changes; HTTP handles authoring, room creation and league queries.

## Event concepts
`room.join`, `room.snapshot`, `room.players`, `game.start`, `question.started`, `answer.submit`, `question.closed`, `round.results`, `leaderboard.updated`, `game.completed`, `player.reconnected`, `error`.

## Fairness
The server broadcasts an authoritative deadline. It timestamps answer arrival, maps the player-specific option ordering to the canonical answer, rejects late/duplicate submissions and calculates score. Client clocks are display-only.

## Reconnection
A join token maps to a player session. On reconnect, the server sends a complete snapshot for the current state, including score, current question, deadline, answered status and leaderboard. Other players continue unaffected.

## Room ownership, custom questions and teams

Each room receives a collision-checked six-character PIN for contestants and a separate cryptographically random host token for control. The PIN identifies a room but grants no permissions. Only a WebSocket client presenting the matching host token can start the game.

Custom questions are normalized and validated before being added to an in-memory question set. A room can use the supplied starter set, custom questions, or both. Correct answers remain server-side and never enter `PlayerQuestion`.

With `teamMode` enabled, players join using a declared team ID. Team totals are derived from authoritative player scores after every round. Snapshots expose both individual and team leaderboards, while the client cannot submit a score.

## Data boundary
The browser receives only the current question and player-safe state. It never receives the complete question set, correct answer, canonical option mapping or trusted score input.