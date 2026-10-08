export const TOPICS = ["quantitative", "logical", "verbal", "data-interpretation"] as const;
export type Topic = (typeof TOPICS)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const GAME_PHASES = ["lobby", "question-active", "question-closed", "round-results", "leaderboard", "complete"] as const;
export type GamePhase = (typeof GAME_PHASES)[number];

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  text: string;
  options: QuestionOption[];
  correctOptionId: string;
  topic: Topic;
  difficulty: Difficulty;
  timeLimitMs: number;
  imageUrl?: string;
  tableMarkdown?: string;
  explanation?: string;
}

export interface QuestionSet {
  id: string;
  title: string;
  description?: string;
  collegeId: string;
  questions: Question[];
  createdAt: string;
  updatedAt: string;
}

export interface Player {
  id: string;
  displayName: string;
  collegeId: string;
  sessionToken: string;
  connected: boolean;
  totalScore: number;
  correctAnswers: number;
  answeredQuestions: number;
  totalResponseTimeMs: number;
  teamId?: string;
  adaptiveDifficulty: Difficulty;
  topicStats: Record<Topic, TopicPerformance>;
}

export interface TopicPerformance {
  attempted: number;
  correct: number;
  totalResponseTimeMs: number;
}

export interface PlayerAnalytics {
  score: number;
  accuracy: number;
  averageResponseTimeMs: number | null;
  attempted: number;
  correct: number;
  incorrect: number;
  topics: Record<Topic, TopicPerformance>;
  readiness: {
    score: number;
    accuracy: number;
    speed: number;
    consistency: number;
  };
  strengths: Topic[];
  weaknesses: Topic[];
  recommendations: Topic[];
}

export interface HostAnalytics {
  participants: number;
  averageScore: number;
  averageAccuracy: number;
  averageResponseTimeMs: number | null;
  mostDifficultQuestion?: { questionId: string; text: string; accuracy: number };
  easiestQuestion?: { questionId: string; text: string; accuracy: number };
  mostCommonIncorrectOption?: { questionId: string; optionId: string; count: number };
  topics: Record<Topic, TopicPerformance>;
}

export interface CollegeLeagueEntry {
  rank: number;
  collegeId: string;
  points: number;
  participants: number;
  period: "weekly" | "monthly" | "all-time";
}

export interface Team {
  id: string;
  name: string;
  totalScore: number;
  memberCount: number;
}

export interface Room {
  id: string;
  code: string;
  hostId: string;
  collegeId: string;
  questionSetId: string;
  phase: GamePhase;
  currentQuestionIndex: number;
  questionStartedAtMs?: number;
  questionDeadlineMs?: number;
  players: Player[];
  teamMode: boolean;
  teams: Team[];
  clutchRound: boolean;
}

export interface PlayerQuestion {
  questionId: string;
  text: string;
  options: QuestionOption[];
  topic: Topic;
  difficulty: Difficulty;
  timeLimitMs: number;
  startedAtMs: number;
  deadlineMs: number;
  isClutch: boolean;
}

export interface AnswerSubmission {
  roomId: string;
  questionId: string;
  optionId: string;
}

export interface AnswerResult {
  playerId: string;
  questionId: string;
  accepted: boolean;
  correct: boolean;
  score: number;
  receivedAtMs: number;
  reason?: "late" | "unanswered" | "duplicate" | "invalid-question" | "invalid-option" | "not-active";
  topic?: Topic;
  difficulty?: Difficulty;
  responseTimeMs?: number;
}

export interface LeaderboardEntry {
  playerId: string;
  displayName: string;
  totalScore: number;
  rank: number;
  rankMovement: number;
  accuracy: number;
  averageResponseTimeMs: number | null;
}

export interface TeamLeaderboardEntry extends Team {
  rank: number;
  rankMovement: number;
}

export interface RoundResult {
  questionId: string;
  correctOptionId: string;
  results: AnswerResult[];
  leaderboard: LeaderboardEntry[];
}

export interface PublicPlayer {
  id: string;
  displayName: string;
  collegeId: string;
  connected: boolean;
  totalScore: number;
  correctAnswers: number;
  answeredQuestions: number;
  teamId?: string;
}

export interface PublicRoom {
  id: string;
  code: string;
  hostId: string;
  collegeId: string;
  questionSetId: string;
  phase: GamePhase;
  currentQuestionIndex: number;
  questionStartedAtMs?: number;
  questionDeadlineMs?: number;
  players: PublicPlayer[];
  teamMode: boolean;
  teams: Team[];
  clutchRound: boolean;
}

export interface GameSnapshot {
  room: PublicRoom;
  currentQuestion?: PlayerQuestion;
  leaderboard: LeaderboardEntry[];
  teamLeaderboard: TeamLeaderboardEntry[];
  analytics: PlayerAnalytics;
  adaptiveDifficulty: Difficulty;
  adaptiveMessage?: string;
  currentRoundResult?: RoundResult;
}

export type ClientEvent =
  | { type: "room.join"; roomCode: string; displayName: string; collegeId: string; sessionToken?: string; teamId?: string; hostToken?: string }
  | { type: "game.start"; roomId: string }
  | { type: "answer.submit"; payload: AnswerSubmission };

export type ServerEvent =
  | { type: "room.snapshot"; payload: GameSnapshot }
  | { type: "question.started"; payload: PlayerQuestion }
  | { type: "answer.result"; payload: AnswerResult }
  | { type: "round.results"; payload: RoundResult }
  | { type: "leaderboard.updated"; payload: LeaderboardEntry[] }
  | { type: "player.reconnected"; payload: { playerId: string; sessionToken?: string; hostToken?: string } }
  | { type: "adaptive.updated"; payload: { difficulty: Difficulty; message: string } }
  | { type: "error"; payload: { code: string; message: string } };

export function isTopic(value: unknown): value is Topic {
  return typeof value === "string" && (TOPICS as readonly string[]).includes(value);
}

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === "string" && (DIFFICULTIES as readonly string[]).includes(value);
}

export function isGamePhase(value: unknown): value is GamePhase {
  return typeof value === "string" && (GAME_PHASES as readonly string[]).includes(value);
}

export { BOOKLET_2026_QUESTION_SET } from './seed.js';
