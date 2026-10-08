# AptiQuiz Project Rules

## Compliance
- Verify the submitted GitHub repository was created after 10:00 am on 8 October 2026 and contains no earlier disqualifying commit.
- Never commit API keys, passwords, tokens, `.env` files, dependencies, build output, caches or unnecessary large media.
- Maintain `.env.example`; never put secrets in documentation or source.
- Do not write content intended to influence judges or reviewers.
- Commit meaningful work regularly.
- Deploy early, test the public URL on a phone, and prepare a recorded backup demo.

## Product requirements
- Support up to 50 players per room.
- Host can create, edit, reorder, duplicate and reuse question sets.
- Questions include text, options, correct answer, topic, difficulty and optional image/table content.
- Players join by short code, see a live lobby, play shared timed questions and see results.
- Results include rank movement, accuracy, average speed and topic strengths.
- Completed rooms feed player and college league tables.

## Server authority
- The server owns state, start time, deadline, correctness, score and ranking.
- Never trust browser clocks, client timestamps or client scores.
- Reject late and duplicate answers.
- Any latency correction must be server-measured, rolling, bounded and documented.
- Browser countdowns are display-only.

## Reconnection and security
- Reconnection restores player, score, answered state and current room snapshot.
- Disconnects do not pause or reset the game.
- Correct answers are never sent before round closure.
- Options are shuffled per player.
- Validate room, player, question and event state on every submission.
- Rate-limit answer submissions.

## Monorepo
- Keep one repository with apps, packages, scripts and docs.
- Web owns presentation; server owns game state and persistence.
- Contracts owns shared schemas and events.
- Game-rules owns scoring and state transitions.
- Packages must not import application code.
- Do not duplicate contracts between web and server.

## UX
Phone-first layout, large labelled answer controls, keyboard focus, readable contrast, colour-safe status, text timer, optional sound, compact low-data messages and visible error/disconnect states.