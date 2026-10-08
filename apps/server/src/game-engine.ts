import type {
  AnswerResult,
  GameSnapshot,
  LeaderboardEntry,
  Player,
  PlayerQuestion,
  PublicPlayer,
  PublicRoom,
  Question,
  QuestionSet,
  Room,
  RoundResult,
  Team,
  TeamLeaderboardEntry,
  Difficulty,
  PlayerAnalytics,
  Topic,
  TopicPerformance,
  HostAnalytics,
  CollegeLeagueEntry,
} from "@aptiquiz/contracts";
import { buildLeaderboard, calculateAnswerResult, toPlayerQuestion } from "@aptiquiz/game-rules";

function emptyTopicStats(): Record<Topic, TopicPerformance> {
  return {
    quantitative: { attempted: 0, correct: 0, totalResponseTimeMs: 0 },
    logical: { attempted: 0, correct: 0, totalResponseTimeMs: 0 },
    verbal: { attempted: 0, correct: 0, totalResponseTimeMs: 0 },
    "data-interpretation": { attempted: 0, correct: 0, totalResponseTimeMs: 0 },
  };
}

function topicAccuracy(stats: TopicPerformance): number {
  return stats.attempted === 0 ? 0 : stats.correct / stats.attempted;
}

function emptyAnalytics(): PlayerAnalytics {
  return {
    score: 0,
    accuracy: 0,
    averageResponseTimeMs: null,
    attempted: 0,
    correct: 0,
    incorrect: 0,
    topics: emptyTopicStats(),
    readiness: { score: 0, accuracy: 0, speed: 0, consistency: 0 },
    strengths: [],
    weaknesses: [],
    recommendations: [],
  };
}

interface InternalRoom extends Room {
  answeredByPlayer: Map<string, AnswerResult>;
  previousRanks: Map<string, number>;
  optionOrders: Map<string, string[]>;
  lastRoundResult?: RoundResult;
  previousTeamRanks: Map<string, number>;
  questionStats: Map<string, { attempted: number; correct: number; incorrectOptions: Map<string, number> }>;
}

export interface CreateRoomInput {
  id: string;
  code: string;
  hostId: string;
  collegeId: string;
  questionSetId: string;
  teamMode?: boolean;
  teams?: Pick<Team, "id" | "name">[];
  clutchRound?: boolean;
}

export interface JoinResult {
  player: Player;
  reconnected: boolean;
}

export class GameEngine {
  private readonly questionSets = new Map<string, QuestionSet>();
  private readonly rooms = new Map<string, InternalRoom>();
  private readonly sessionToPlayer = new Map<string, { roomId: string; playerId: string }>();

  constructor(questionSets: readonly QuestionSet[] = []) {
    for (const questionSet of questionSets) this.questionSets.set(questionSet.id, questionSet);
  }

  addQuestionSet(questionSet: QuestionSet): void {
    if (questionSet.questions.length === 0) throw new Error("A question set must contain at least one question");
    this.questionSets.set(questionSet.id, questionSet);
  }

  createRoom(input: CreateRoomInput): PublicRoom {
    if (this.rooms.has(input.id)) throw new Error("Room already exists");
    if (!this.questionSets.has(input.questionSetId)) throw new Error("Question set not found");
    const room: InternalRoom = {
      ...input,
      phase: "lobby",
      currentQuestionIndex: -1,
      players: [],
      teamMode: input.teamMode ?? false,
      teams: (input.teams ?? []).map((team) => ({ ...team, totalScore: 0, memberCount: 0 })),
      clutchRound: input.clutchRound ?? false,
      answeredByPlayer: new Map(),
      previousRanks: new Map(),
      optionOrders: new Map(),
      previousTeamRanks: new Map(),
      questionStats: new Map(),
    };
    this.rooms.set(room.id, room);
    return this.publicRoom(room);
  }

  joinRoom(roomId: string, displayName: string, collegeId: string, sessionToken?: string, playerId = `player-${(this.rooms.get(roomId)?.players.length ?? 0) + 1}`, teamId?: string): JoinResult {
    const room = this.getRoom(roomId);
    if (!displayName.trim()) throw new Error("Display name is required");
    if (room.phase !== "lobby" && !sessionToken) throw new Error("The game has already started");

    if (sessionToken) {
      const session = this.sessionToPlayer.get(sessionToken);
      if (session?.roomId === roomId) {
        const player = room.players.find((candidate) => candidate.id === session.playerId);
        if (player) {
          player.connected = true;
          return { player, reconnected: true };
        }
      }
    }

    if (room.players.length >= 50) throw new Error("Room is full");
    if (room.players.some((player) => player.displayName.toLowerCase() === displayName.trim().toLowerCase())) {
      throw new Error("Display name is already in use");
    }
    if (teamId && (!room.teamMode || !room.teams.some((team) => team.id === teamId))) throw new Error("Invalid team selection");
    const token = sessionToken ?? this.createSessionToken();
    const player: Player = {
      id: playerId,
      displayName: displayName.trim(),
      collegeId,
      sessionToken: token,
      connected: true,
      totalScore: 0,
      correctAnswers: 0,
      answeredQuestions: 0,
      totalResponseTimeMs: 0,
      teamId,
      adaptiveDifficulty: "medium",
      topicStats: emptyTopicStats(),
    };
    room.players.push(player);
    this.sessionToPlayer.set(token, { roomId, playerId: player.id });
    return { player, reconnected: false };
  }

  disconnect(roomId: string, playerId: string): void {
    const player = this.getRoom(roomId).players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error("Player not found");
    player.connected = false;
  }

  startGame(roomId: string, startedAtMs: number): PlayerQuestion {
    const room = this.getRoom(roomId);
    if (room.phase !== "lobby") throw new Error("Game has already started");
    if (room.players.length === 0) throw new Error("At least one player is required");
    return this.startQuestion(room, 0, startedAtMs);
  }

  submitAnswer(roomId: string, playerId: string, submission: { questionId: string; optionId: string }, receivedAtMs: number, latencyCompensationMs = 0): AnswerResult {
    const room = this.getRoom(roomId);
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error("Player not found");
    const question = this.currentQuestion(room);
    const result = calculateAnswerResult(playerId, room, question, submission, receivedAtMs, latencyCompensationMs, room.answeredByPlayer.has(playerId));
    if (!result.accepted) return result;

    if (room.clutchRound && this.isClutchQuestion(room) && result.correct) result.score = Math.round(result.score * 1.5);
    room.answeredByPlayer.set(playerId, result);
    player.answeredQuestions += 1;
    if (result.correct) player.correctAnswers += 1;
    player.totalScore += result.score;
    const responseTimeMs = result.responseTimeMs ?? Math.max(0, receivedAtMs - (room.questionStartedAtMs ?? receivedAtMs));
    player.totalResponseTimeMs += responseTimeMs;
    if (result.topic) {
      const topicStats = player.topicStats[result.topic];
      topicStats.attempted += 1;
      topicStats.correct += result.correct ? 1 : 0;
      topicStats.totalResponseTimeMs += responseTimeMs;
    }
    const questionStats = room.questionStats.get(question.id) ?? { attempted: 0, correct: 0, incorrectOptions: new Map<string, number>() };
    questionStats.attempted += 1;
    if (result.correct) questionStats.correct += 1;
    else questionStats.incorrectOptions.set(submission.optionId, (questionStats.incorrectOptions.get(submission.optionId) ?? 0) + 1);
    room.questionStats.set(question.id, questionStats);
    this.updateAdaptiveDifficulty(player);
    if (room.answeredByPlayer.size === room.players.length) this.closeQuestionInternal(room);
    return result;
  }

  closeQuestion(roomId: string, closedAtMs = Date.now()): RoundResult {
    const room = this.getRoom(roomId);
    return this.closeQuestionInternal(room, closedAtMs);
  }

  roundResult(roomId: string): RoundResult | undefined {
    return this.getRoom(roomId).lastRoundResult;
  }

  advance(roomId: string, startedAtMs: number): PlayerQuestion | null {
    const room = this.getRoom(roomId);
    if (room.phase !== "round-results" && room.phase !== "leaderboard") throw new Error("Round is not ready to advance");
    const questionSet = this.getQuestionSet(room.questionSetId);
    const nextIndex = room.currentQuestionIndex + 1;
    if (nextIndex >= questionSet.questions.length) {
      room.phase = "complete";
      room.questionStartedAtMs = undefined;
      room.questionDeadlineMs = undefined;
      return null;
    }
    return this.startQuestion(room, nextIndex, startedAtMs);
  }

  snapshot(roomId: string, playerId?: string): GameSnapshot {
    const room = this.getRoom(roomId);
    const leaderboard = buildLeaderboard(room.players, room.previousRanks);
    const currentQuestion = room.phase === "question-active" && playerId ? this.playerQuestionFor(room, playerId) : undefined;
    const player = playerId ? room.players.find((candidate) => candidate.id === playerId) : undefined;
    return {
      room: this.publicRoom(room),
      currentQuestion,
      leaderboard,
      teamLeaderboard: this.teamLeaderboard(room),
      analytics: player ? this.analyticsFor(player) : emptyAnalytics(),
      adaptiveDifficulty: player?.adaptiveDifficulty ?? "medium",
      adaptiveMessage: player ? this.adaptiveMessage(player) : undefined,
    };
  }

  findBySession(sessionToken: string): { roomId: string; playerId: string } | undefined {
    return this.sessionToPlayer.get(sessionToken);
  }

  hostAnalytics(roomId: string): HostAnalytics {
    const room = this.getRoom(roomId);
    const players = room.players;
    const topics = emptyTopicStats();
    for (const player of players) {
      for (const topic of Object.keys(topics) as Topic[]) {
        topics[topic].attempted += player.topicStats[topic].attempted;
        topics[topic].correct += player.topicStats[topic].correct;
        topics[topic].totalResponseTimeMs += player.topicStats[topic].totalResponseTimeMs;
      }

    }
    const entries = [...room.questionStats.entries()].map(([questionId, stats]) => ({ questionId, stats }));
    const questionSet = this.getQuestionSet(room.questionSetId);
    const questionInsight = (entry: { questionId: string; stats: { attempted: number; correct: number } }) => {
      const question = questionSet.questions.find((candidate) => candidate.id === entry.questionId);
      return question ? { questionId: question.id, text: question.text, accuracy: entry.stats.attempted === 0 ? 0 : entry.stats.correct / entry.stats.attempted } : undefined;
    };
    const difficult = entries.map((entry) => questionInsight(entry)).filter(Boolean).sort((left, right) => (left?.accuracy ?? 0) - (right?.accuracy ?? 0))[0];
    const easy = entries.map((entry) => questionInsight(entry)).filter(Boolean).sort((left, right) => (right?.accuracy ?? 0) - (left?.accuracy ?? 0))[0];
    const optionCounts = entries.flatMap(({ questionId, stats }) => [...stats.incorrectOptions.entries()].map(([optionId, count]) => ({ questionId, optionId, count }))).sort((left, right) => right.count - left.count)[0];
    return {
      participants: players.length,
      averageScore: players.length ? Math.round(players.reduce((sum, player) => sum + player.totalScore, 0) / players.length) : 0,
      averageAccuracy: players.length ? players.reduce((sum, player) => sum + (player.answeredQuestions ? player.correctAnswers / player.answeredQuestions : 0), 0) / players.length : 0,
      averageResponseTimeMs: players.length ? Math.round(players.reduce((sum, player) => sum + player.totalResponseTimeMs, 0) / Math.max(1, players.reduce((sum, player) => sum + player.answeredQuestions, 0))) : null,
      mostDifficultQuestion: difficult,
      easiestQuestion: easy,
      mostCommonIncorrectOption: optionCounts,
      topics,
    };
  }

  collegeLeague(period: CollegeLeagueEntry["period"] = "all-time"): CollegeLeagueEntry[] {
    const byCollege = new Map<string, { points: number; participants: Set<string> }>();
    for (const room of this.rooms.values()) {
      if (room.phase !== "complete") continue;
      const current = byCollege.get(room.collegeId) ?? { points: 0, participants: new Set<string>() };
      for (const player of room.players) {
        current.points += player.totalScore;
        current.participants.add(`${room.id}:${player.id}`);
      }
      byCollege.set(room.collegeId, current);
    }
    return [...byCollege.entries()]
      .sort((left, right) => right[1].points - left[1].points)
      .map(([collegeId, entry], index) => ({ rank: index + 1, collegeId, points: entry.points, participants: entry.participants.size, period }));
  }

  private startQuestion(room: InternalRoom, questionIndex: number, startedAtMs: number): PlayerQuestion {
    const question = this.getQuestionSet(room.questionSetId).questions[questionIndex];
    if (!question) throw new Error("Question not found");
    room.phase = "question-active";
    room.currentQuestionIndex = questionIndex;
    room.questionStartedAtMs = startedAtMs;
    room.questionDeadlineMs = startedAtMs + question.timeLimitMs;
    room.answeredByPlayer.clear();
    room.optionOrders.clear();
    const firstPlayerId = room.players[0]?.id;
    if (!firstPlayerId) throw new Error("At least one player is required");
    return this.playerQuestionFor(room, firstPlayerId)!;
  }

  private closeQuestionInternal(room: InternalRoom, _closedAtMs = Date.now()): RoundResult {
    if (room.phase !== "question-active") throw new Error("Question is not active");
    const question = this.currentQuestion(room);
    const previous = buildLeaderboard(room.players, room.previousRanks);
    room.phase = "round-results";
    const leaderboard = buildLeaderboard(room.players, new Map(previous.map((entry) => [entry.playerId, entry.rank])));
    room.previousRanks = new Map(leaderboard.map((entry) => [entry.playerId, entry.rank]));
    room.previousTeamRanks = new Map(this.teamLeaderboard(room).map((entry) => [entry.id, entry.rank]));
    const roundResult: RoundResult = {
      questionId: question.id,
      correctOptionId: question.correctOptionId,
      results: [...room.answeredByPlayer.values()],
      leaderboard,
    };
    room.lastRoundResult = roundResult;
    return roundResult;
  }
  private playerQuestionFor(room: InternalRoom, playerId?: string): PlayerQuestion | undefined {
    if (!playerId) return undefined;
    const question = this.currentQuestion(room);
    const base = toPlayerQuestion(question, room.questionStartedAtMs ?? Date.now(), room.clutchRound && this.isClutchQuestion(room));
    const orderKey = `${room.id}:${question.id}:${playerId}`;
    let order = room.optionOrders.get(orderKey);
    if (!order) {
      order = this.shuffle(question.options.map((option) => option.id));
      room.optionOrders.set(orderKey, order);
    }
    return { ...base, options: order.map((id) => question.options.find((option) => option.id === id)!).filter(Boolean) };
  }

  private publicRoom(room: InternalRoom): PublicRoom {
    return {
      id: room.id,
      code: room.code,
      hostId: room.hostId,
      collegeId: room.collegeId,
      questionSetId: room.questionSetId,
      phase: room.phase,
      currentQuestionIndex: room.currentQuestionIndex,
      questionStartedAtMs: room.questionStartedAtMs,
      questionDeadlineMs: room.questionDeadlineMs,
      players: room.players.map<PublicPlayer>(({ sessionToken: _sessionToken, ...player }) => player),
      teamMode: room.teamMode,
      teams: this.teamLeaderboard(room),
      clutchRound: room.clutchRound,
    };
  }

  private teamLeaderboard(room: InternalRoom): TeamLeaderboardEntry[] {
    const entries = room.teams.map((team) => ({
      ...team,
      totalScore: room.players.filter((player) => player.teamId === team.id).reduce((sum, player) => sum + player.totalScore, 0),
      memberCount: room.players.filter((player) => player.teamId === team.id).length,
    })).sort((left, right) => right.totalScore - left.totalScore || left.name.localeCompare(right.name));
    return entries.map((team, index) => {
      const rank = index + 1;
      const previousRank = room.previousTeamRanks.get(team.id);
      return { ...team, rank, rankMovement: previousRank === undefined ? 0 : previousRank - rank };
    });
  }

  private isClutchQuestion(room: InternalRoom): boolean {
    const questions = this.getQuestionSet(room.questionSetId).questions;
    return room.currentQuestionIndex >= Math.max(0, questions.length - 3);
  }

  private updateAdaptiveDifficulty(player: Player): void {
    if (player.answeredQuestions < 3) return;
    const accuracy = player.correctAnswers / player.answeredQuestions;
    const order: Difficulty[] = ["easy", "medium", "hard"];
    const current = order.indexOf(player.adaptiveDifficulty);
    if (accuracy >= 0.8 && current < order.length - 1) player.adaptiveDifficulty = order[current + 1];
    if (accuracy <= 0.45 && current > 0) player.adaptiveDifficulty = order[current - 1];
  }

  private adaptiveMessage(player: Player): string | undefined {
    if (player.answeredQuestions < 3) return "We are calibrating your difficulty";
    return player.adaptiveDifficulty === "hard" ? "Difficulty increased" : player.adaptiveDifficulty === "easy" ? "Difficulty adjusted to build confidence" : "Difficulty is balanced";
  }

  private analyticsFor(player: Player): PlayerAnalytics {
    const accuracy = player.answeredQuestions === 0 ? 0 : player.correctAnswers / player.answeredQuestions;
    const averageResponseTimeMs = player.answeredQuestions === 0 ? null : Math.round(player.totalResponseTimeMs / player.answeredQuestions);
    const topics = player.topicStats;
    const ranked = (Object.keys(topics) as Topic[]).filter((topic) => topics[topic].attempted > 0).sort((left, right) => topicAccuracy(topics[right]) - topicAccuracy(topics[left]));
    const speed = averageResponseTimeMs === null ? 0 : Math.max(0, Math.min(100, Math.round(100 - averageResponseTimeMs / 50)));
    const readiness = Math.round(accuracy * 45 + speed * 0.3 + (ranked.length ? topicAccuracy(topics[ranked[0]]) * 25 : 0));
    return {
      score: player.totalScore,
      accuracy,
      averageResponseTimeMs,
      attempted: player.answeredQuestions,
      correct: player.correctAnswers,
      incorrect: Math.max(0, player.answeredQuestions - player.correctAnswers),
      topics,
      readiness: { score: Math.max(0, Math.min(100, readiness)), accuracy: Math.round(accuracy * 100), speed, consistency: ranked.length >= 2 ? Math.round((topicAccuracy(topics[ranked[0]]) + topicAccuracy(topics[ranked[ranked.length - 1]])) * 50) : Math.round(accuracy * 100) },
      strengths: ranked.slice(0, 2),
      weaknesses: ranked.slice(-2).reverse(),
      recommendations: ranked.slice(-3).reverse(),
    };
  }

  private currentQuestion(room: InternalRoom): Question {
    const question = this.getQuestionSet(room.questionSetId).questions[room.currentQuestionIndex];
    if (!question) throw new Error("Current question not found");
    return question;
  }

  private getRoom(roomId: string): InternalRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("Room not found");
    return room;
  }

  private getQuestionSet(questionSetId: string): QuestionSet {
    const questionSet = this.questionSets.get(questionSetId);
    if (!questionSet) throw new Error("Question set not found");
    return questionSet;
  }

  private createSessionToken(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  }

  private shuffle<T>(items: T[]): T[] {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
    return items;
  }
}