import type {
  AnswerResult,
  LeaderboardEntry,
  Player,
  PlayerQuestion,
  Question,
  Room,
} from "@aptiquiz/contracts";

export const BASE_SCORE = 1000;
export const MINIMUM_CORRECT_SCORE = 100;
export const MAX_LATENCY_COMPENSATION_MS = 250;

export function scoreCorrectAnswer(
  timeLimitMs: number,
  receivedAtMs: number,
  startedAtMs: number,
  latencyCompensationMs = 0,
): number {
  if (!Number.isFinite(timeLimitMs) || timeLimitMs <= 0 || !Number.isFinite(receivedAtMs) || !Number.isFinite(startedAtMs)) return 0;
  const safeCompensation = Number.isFinite(latencyCompensationMs) ? latencyCompensationMs : 0;
  const boundedCompensation = Math.min(Math.max(safeCompensation, 0), MAX_LATENCY_COMPENSATION_MS);
  const elapsedMs = Math.max(0, receivedAtMs - startedAtMs - boundedCompensation);
  if (elapsedMs > timeLimitMs) return 0;
  const remainingRatio = Math.max(0, Math.min(1, (timeLimitMs - elapsedMs) / timeLimitMs));
  return Math.round(MINIMUM_CORRECT_SCORE + (BASE_SCORE - MINIMUM_CORRECT_SCORE) * remainingRatio);
}

export function canAcceptAnswer(
  room: Room,
  question: Question,
  questionId: string,
  optionId: string,
  receivedAtMs: number,
  alreadyAnswered: boolean,
): AnswerResult["reason"] | null {
  if (room.phase !== "question-active") return "not-active";
  if (alreadyAnswered) return "duplicate";
  if (question.id !== questionId || room.questionDeadlineMs === undefined) return "invalid-question";
  if (!question.options.some((option) => option.id === optionId)) return "invalid-option";
  if (receivedAtMs > room.questionDeadlineMs) return "late";
  return null;
}

export function calculateAnswerResult(
  playerId: string,
  room: Room,
  question: Question,
  submission: { questionId: string; optionId: string },
  receivedAtMs: number,
  latencyCompensationMs = 0,
  alreadyAnswered = false,
): AnswerResult {
  const reason = canAcceptAnswer(room, question, submission.questionId, submission.optionId, receivedAtMs, alreadyAnswered);
  if (reason) {
    return { playerId, questionId: submission.questionId, accepted: false, correct: false, score: 0, receivedAtMs, reason, topic: question.topic, difficulty: question.difficulty };
  }

  const correct = submission.optionId === question.correctOptionId;
  const score = correct
    ? scoreCorrectAnswer(question.timeLimitMs, receivedAtMs, room.questionStartedAtMs ?? receivedAtMs, latencyCompensationMs)
    : 0;
  return {
    playerId,
    questionId: submission.questionId,
    accepted: true,
    correct,
    score,
    receivedAtMs,
    topic: question.topic,
    difficulty: question.difficulty,
    responseTimeMs: Math.max(0, receivedAtMs - (room.questionStartedAtMs ?? receivedAtMs)),
  };
}

export function buildLeaderboard(players: readonly Player[], previousRanks = new Map<string, number>()): LeaderboardEntry[] {
  const ordered = [...players].sort((a, b) => b.totalScore - a.totalScore || a.displayName.localeCompare(b.displayName));
  return ordered.map((player, index) => {
    const rank = index + 1;
    const previousRank = previousRanks.get(player.id);
    return {
      playerId: player.id,
      displayName: player.displayName,
      totalScore: player.totalScore,
      rank,
      rankMovement: previousRank === undefined ? 0 : previousRank - rank,
      accuracy: player.answeredQuestions === 0 ? 0 : player.correctAnswers / player.answeredQuestions,
      averageResponseTimeMs: player.answeredQuestions === 0 ? null : Math.round(player.totalResponseTimeMs / player.answeredQuestions),
    };
  });
}

export function toPlayerQuestion(question: Question, startedAtMs: number, isClutch = false): PlayerQuestion {
  return {
    questionId: question.id,
    text: question.text,
    options: question.options,
    imageUrl: question.imageUrl,
    tableMarkdown: question.tableMarkdown,
    topic: question.topic,
    difficulty: question.difficulty,
    timeLimitMs: question.timeLimitMs,
    startedAtMs,
    deadlineMs: startedAtMs + question.timeLimitMs,
    isClutch,
  };
}
