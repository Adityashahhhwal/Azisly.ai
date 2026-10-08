import assert from "node:assert/strict";
import test from "node:test";
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
  assert.equal(accepted.score, 820);

  const duplicate = engine.submitAnswer("room-1", first.player.id, { questionId: question.questionId, optionId: correctOptionId }, 6_000);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, "duplicate");

  const late = engine.submitAnswer("room-1", second.player.id, { questionId: question.questionId, optionId: correctOptionId }, 21_001);
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
  assert.equal(reconnected.player.totalScore, 955);
  assert.equal(reconnected.player.connected, true);
});