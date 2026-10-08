# 50-Player Load Test

## Purpose
Prove the required room size and observe whether joins, broadcasts, submissions, round closure, leaderboard updates and reconnection behave correctly.

## Required scenario
- Start a test server.
- Create one room with a seeded question set.
- Connect 50 simulated players.
- Verify all 50 appear in the lobby.
- Start at least five rounds.
- Submit answers with varied delays and simulated latency.
- Include wrong, duplicate and late submissions.
- Disconnect and reconnect multiple players during active rounds.
- Verify scores, round closure and leaderboard consistency.

## Record
- Player count
- Round count
- Join failures
- Submission failures
- Late/duplicate rejection count
- Average and p95 event latency
- Reconnection success count
- Server errors
- Test duration

## README command
The final command will be added after the package manager and test runner are selected, for example:

```text
run the server
run the 50-player simulator against the test URL
```

Do not report a result until the script has actually been run. Keep the simulator in the repository.