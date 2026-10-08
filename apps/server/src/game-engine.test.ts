import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOOKLET_2026_QUESTION_SET } from "@aptiquiz/contracts";
import { GameEngine } from "./game-engine.js";

function createFixture() {
  const engine = new GameEngine([BOOKLET_2026_QUESTION_SET]);
  engine.createRoom({
    id: "room-1",
    code: "APT123",
    hostId: "host-1",
    collegeId: "demo-college",
    questionSetId: BOOKLET_2026_QUESTION_SET.id,
  });
  const first = engine.joinRoom("room-1", "Asha", "demo-college");
  const second = engine.joinRoom("room-1", "Ravi", "demo-college");
  return { engine, first, second };
}

test("keeps session tokens and correct answers out of public snapshots", () => {
  const { engine, first, second } = createFixture();
  const question = engine.startGame("room-1", 1_000);
  const snapshot = engine.snapshot("room-1", first.player.id);
  assert.equal(snapshot.currentQuestion?.questionId, question.questionId);
  assert.ok(snapshot.currentQuestion);
  assert.equal("correctOptionId" in snapshot.currentQuestion, false);
  assert.equal("sessionToken" in snapshot.room.players[0], false);
  assert.equal(snapshot.room.players.length, 2);
  assert.notEqual(first.player.sessionToken, second.player.sessionToken);
});

test("scores accepted answers and rejects duplicates and late submissions", () => {
  const { engine, first, second } = createFixture();
  const question = engine.startGame("room-1", 1_000);
  const correctOptionId = BOOKLET_2026_QUESTION_SET.questions[0].correctOptionId;
  const accepted = engine.submitAnswer("room-1", first.player.id, { questionId: question.questionId, optionId: correctOptionId }, 5_000);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.correct, true);
  assert.equal(accepted.score, 988);

  const duplicate = engine.submitAnswer("room-1", first.player.id, { questionId: question.questionId, optionId: correctOptionId }, 6_000);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, "duplicate");

  const late = engine.submitAnswer("room-1", second.player.id, { questionId: question.questionId, optionId: correctOptionId }, 301_001);
  assert.equal(late.accepted, false);
  assert.equal(late.reason, "late");
});

test("closes a round when every player answers and advances", () => {
  const { engine, first, second } = createFixture();
  const question = engine.startGame("room-1", 1_000);
  const correctOptionId = BOOKLET_2026_QUESTION_SET.questions[0].correctOptionId;
  engine.submitAnswer("room-1", first.player.id, { questionId: question.questionId, optionId: correctOptionId }, 2_000);
  engine.submitAnswer("room-1", second.player.id, { questionId: question.questionId, optionId: "a" }, 3_000);
  assert.equal(engine.snapshot("room-1").room.phase, "round-results");
  const next = engine.advance("room-1", 4_000);
  assert.equal(next?.questionId, BOOKLET_2026_QUESTION_SET.questions[1].id);
  assert.equal(engine.snapshot("room-1").room.currentQuestionIndex, 1);
});

test("reconnects a player with the same score and identity", () => {
  const { engine, first } = createFixture();
  const question = engine.startGame("room-1", 1_000);
  const correctOptionId = BOOKLET_2026_QUESTION_SET.questions[0].correctOptionId;
  engine.submitAnswer("room-1", first.player.id, { questionId: question.questionId, optionId: correctOptionId }, 2_000);
  engine.disconnect("room-1", first.player.id);
  const reconnected = engine.joinRoom("room-1", "Asha", "demo-college", first.player.sessionToken);
  assert.equal(reconnected.reconnected, true);
  assert.equal(reconnected.player.id, first.player.id);
  assert.equal(reconnected.player.totalScore, 997);
  assert.equal(reconnected.player.connected, true);
});

test("does not allow a session token to cross room boundaries", () => {
  const engine = new GameEngine([BOOKLET_2026_QUESTION_SET]);
  engine.createRoom({ id: "room-a", code: "AAA111", hostId: "host-a", collegeId: "college-a", questionSetId: BOOKLET_2026_QUESTION_SET.id });
  engine.createRoom({ id: "room-b", code: "BBB222", hostId: "host-b", collegeId: "college-b", questionSetId: BOOKLET_2026_QUESTION_SET.id });
  const player = engine.joinRoom("room-a", "Asha", "college-a");
  assert.throws(() => engine.joinRoom("room-b", "Asha", "college-b", player.player.sessionToken), /another room/);
});

test("calculates team totals and player analytics from server answers", () => {
  const engine = new GameEngine([BOOKLET_2026_QUESTION_SET]);
  engine.createRoom({
    id: "team-room",
    code: "TEAM99",
    hostId: "host-team",
    collegeId: "college-team",
    questionSetId: BOOKLET_2026_QUESTION_SET.id,
    teamMode: true,
    teams: [{ id: "team-1", name: "Alpha" }, { id: "team-2", name: "Beta" }],
  });
  const alpha = engine.joinRoom("team-room", "Alpha player", "college-team", undefined, undefined, "team-1");
  const beta = engine.joinRoom("team-room", "Beta player", "college-team", undefined, undefined, "team-2");
  const question = engine.startGame("team-room", 1_000);
  const correctOptionId = BOOKLET_2026_QUESTION_SET.questions[0].correctOptionId;
  engine.submitAnswer("team-room", alpha.player.id, { questionId: question.questionId, optionId: correctOptionId }, 2_000);
  engine.submitAnswer("team-room", beta.player.id, { questionId: question.questionId, optionId: "invalid" }, 2_100);
  const snapshot = engine.snapshot("team-room", alpha.player.id);
  assert.equal(snapshot.teamLeaderboard.find((team) => team.id === "team-1")?.totalScore, 997);
  assert.equal(snapshot.analytics.correct, 1);
  assert.equal(snapshot.analytics.accuracy, 1);
  assert.equal(snapshot.analytics.topics[BOOKLET_2026_QUESTION_SET.questions[0].topic].correct, 1);
});

test("raises adaptive difficulty after sustained correct answers", () => {
  const engine = new GameEngine([BOOKLET_2026_QUESTION_SET]);
  engine.createRoom({ id: "adaptive-room", code: "ADAPT1", hostId: "host-adaptive", collegeId: "college-a", questionSetId: BOOKLET_2026_QUESTION_SET.id });
  const player = engine.joinRoom("adaptive-room", "Consistent player", "college-a");
  for (let index = 0; index < 3; index += 1) {
    const question = index === 0
      ? engine.startGame("adaptive-room", 1_000)
      : engine.advance("adaptive-room", 1_000 + index * 25_000);
    assert.ok(question);
    const correctOptionId = BOOKLET_2026_QUESTION_SET.questions[index].correctOptionId;
    engine.submitAnswer("adaptive-room", player.player.id, { questionId: question.questionId, optionId: correctOptionId }, 2_000 + index * 25_000);
  }
  assert.equal(engine.snapshot("adaptive-room", player.player.id).adaptiveDifficulty, "hard");
});

test("restores rooms, sessions, scores and analytics after an engine restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "aptiquiz-"));
  const statePath = join(directory, "engine.json");
  try {
    const firstEngine = new GameEngine([BOOKLET_2026_QUESTION_SET], statePath);
    firstEngine.createRoom({ id: "persistent-room", code: "PERSIST", hostId: "host-persistent", collegeId: "college-persistent", questionSetId: BOOKLET_2026_QUESTION_SET.id });
    const player = firstEngine.joinRoom("persistent-room", "Persistent player", "college-persistent");
    const question = firstEngine.startGame("persistent-room", 10_000);
    const correctOptionId = BOOKLET_2026_QUESTION_SET.questions[0].correctOptionId;
    firstEngine.submitAnswer("persistent-room", player.player.id, { questionId: question.questionId, optionId: correctOptionId }, 11_000);

    const restoredEngine = new GameEngine([BOOKLET_2026_QUESTION_SET], statePath);
    const restoredRoom = restoredEngine.listRooms().find((room) => room.id === "persistent-room");
    assert.equal(restoredRoom?.phase, "round-results");
    const restored = restoredEngine.joinRoom("persistent-room", "Persistent player", "college-persistent", player.player.sessionToken);
    assert.equal(restored.reconnected, true);
    assert.equal(restored.player.totalScore, player.player.totalScore);
    assert.equal(restoredEngine.snapshot("persistent-room", restored.player.id).analytics.correct, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});