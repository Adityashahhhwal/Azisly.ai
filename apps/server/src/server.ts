import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientEvent, Question, QuestionSet, ServerEvent, Team } from "@aptiquiz/contracts";
import { BOOKLET_2026_QUESTION_SET } from "@aptiquiz/contracts";
import { isDifficulty, isTopic } from "@aptiquiz/contracts";
import { GameEngine } from "./game-engine.js";

interface ConnectedClient {
  socket: WebSocket;
  roomId?: string;
  playerId?: string;
  sessionToken?: string;
  isHost?: boolean;
}

interface RoomRecord {
  roomId: string;
  code: string;
  timer?: NodeJS.Timeout;
  advanceTimer?: NodeJS.Timeout;
  hostToken: string;
}

export interface ServerOptions {
  port?: number;
  origin?: string;
}

export function createAptiQuizServer(options: ServerOptions = {}) {
  const dataDirectory = process.env.APTIQUIZ_DATA_DIR ?? ".aptiquiz-data";
  const engine = new GameEngine([BOOKLET_2026_QUESTION_SET], join(dataDirectory, "engine.json"));
  const clients = new Set<ConnectedClient>();
  const roomsByCode = new Map<string, RoomRecord>();
  const roomsById = new Map<string, RoomRecord>();
  const origin = options.origin ?? "*";
  const persistedServerState = loadServerState(join(dataDirectory, "server.json"));
  const restoredRoomIds = new Set(engine.listRooms().map((room) => room.id));
  for (const record of persistedServerState) {
    if (!restoredRoomIds.has(record.roomId)) continue;
    roomsByCode.set(record.code, record);
    roomsById.set(record.roomId, record);
  }

  const httpServer = createServer((request, response) => {
    addCors(response, origin);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { status: "ok", service: "aptiquiz-server" });
      return;
    }
    const analyticsMatch = request.method === "GET" ? request.url?.match(/^\/rooms\/([^/]+)\/analytics$/) : undefined;
    if (analyticsMatch) {
      const record = roomsByCode.get(analyticsMatch[1]) ?? roomsById.get(analyticsMatch[1]);
      if (!record) {
        sendJson(response, 404, { error: "Room not found" });
        return;
      }
      if (request.method === "GET" && request.url?.startsWith("/league")) {
        const period = new URL(request.url, "http://localhost").searchParams.get("period");
        const selectedPeriod = period === "weekly" || period === "monthly" ? period : "all-time";
        sendJson(response, 200, engine.collegeLeague(selectedPeriod));
        return;
      }
      if (request.headers["x-host-token"] !== record.hostToken) {
        sendJson(response, 403, { error: "Host authorization required" });
        return;
      }
      sendJson(response, 200, engine.hostAnalytics(record.roomId));
      return;
    }
    if (request.method === "POST" && request.url === "/rooms") {
      readJson(request).then((body) => {
        const payload = asRecord(body);
        const collegeId = requiredString(payload.collegeId, "collegeId");
        const requestedQuestionSetId = requiredString(payload.questionSetId ?? BOOKLET_2026_QUESTION_SET.id, "questionSetId");
        let questionSetId = requestedQuestionSetId;
        const customQuestions = payload.customQuestions === undefined ? [] : parseQuestions(payload.customQuestions);
        if (customQuestions.length > 0) {
          questionSetId = `custom-${randomUUID()}`;
          const questionSet: QuestionSet = {
            id: questionSetId,
            title: typeof payload.questionSetTitle === "string" && payload.questionSetTitle.trim() ? payload.questionSetTitle.trim() : "Custom AptiQuiz set",
            collegeId,
            questions: [...(requestedQuestionSetId === BOOKLET_2026_QUESTION_SET.id ? BOOKLET_2026_QUESTION_SET.questions : []), ...customQuestions],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          engine.addQuestionSet(questionSet);
        }
        const roomId = randomUUID();
        const code = createRoomCode(roomsByCode);
        const hostToken = createToken("host");
        const teams = parseTeams(payload.teams);
        const room = engine.createRoom({ id: roomId, code, hostId: randomUUID(), collegeId, questionSetId, teamMode: payload.teamMode === true, teams, clutchRound: payload.clutchRound === true });
        const record = { roomId, code, hostToken } satisfies RoomRecord;
        roomsByCode.set(code, record);
        roomsById.set(roomId, record);
        persistServerState(join(dataDirectory, "server.json"), [...roomsById.values()].map(({ roomId: persistedRoomId, code: persistedCode, hostToken: persistedHostToken }) => ({ roomId: persistedRoomId, code: persistedCode, hostToken: persistedHostToken })));
        sendJson(response, 201, { ...room, hostToken });
      }).catch((error: unknown) => sendError(response, error));
      return;
    }
    if (request.method === "POST" && request.url === "/question-generator") {
      readJson(request).then((body) => {
        const payload = asRecord(body);
        const topic = requiredString(payload.topic ?? "quantitative", "topic");
        const difficulty = requiredString(payload.difficulty ?? "medium", "difficulty");
        const count = typeof payload.count === "number" ? Math.max(1, Math.min(20, Math.floor(payload.count))) : 5;
        if (!isTopic(topic) || !isDifficulty(difficulty)) throw new Error("Invalid topic or difficulty");
        sendJson(response, 200, { questions: generateQuestionDrafts(topic, difficulty, count) });
      }).catch((error: unknown) => sendError(response, error));
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  });

  const websocketServer = new WebSocketServer({ server: httpServer });
  websocketServer.on("connection", (socket) => {
    const client: ConnectedClient = { socket };
    clients.add(client);
    socket.on("message", (raw) => handleClientMessage(client, raw.toString()));
    socket.on("close", () => {
      clients.delete(client);
      if (client.roomId && client.playerId) {
        try { engine.disconnect(client.roomId, client.playerId); } catch { /* room may have expired */ }
        broadcastSnapshot(client.roomId);
      }
    });
    socket.on("error", () => socket.close());
  });

  function handleClientMessage(client: ConnectedClient, raw: string): void {
    try {
      const event = JSON.parse(raw) as ClientEvent;
      if (event.type === "room.join") {
        const record = roomsByCode.get(event.roomCode.toUpperCase());
        if (!record) throw new Error("Room not found");
        const joined = engine.joinRoom(record.roomId, event.displayName, event.collegeId, event.sessionToken, undefined, event.teamId);
        client.roomId = record.roomId;
        client.playerId = joined.player.id;
        client.sessionToken = joined.player.sessionToken;
        client.isHost = event.hostToken === record.hostToken;
        send(client, { type: "player.reconnected", payload: { playerId: joined.player.id, sessionToken: joined.player.sessionToken, hostToken: client.isHost ? record.hostToken : undefined } });
        send(client, { type: "room.snapshot", payload: engine.snapshot(record.roomId, joined.player.id) });
        broadcastSnapshot(record.roomId);
        return;
      }
      if (event.type === "game.start") {
        requireClientRoom(client, event.roomId);
        if (!client.isHost) throw new Error("Only the room host can start the game");
        const question = engine.startGame(event.roomId, Date.now());
        broadcastSnapshot(event.roomId);
        broadcastQuestion(event.roomId, question.questionId);
        scheduleQuestionClose(event.roomId);
        return;
      }
      if (event.type === "answer.submit") {
        const roomId = event.payload.roomId;
        requireClientRoom(client, roomId);
        if (!client.playerId) throw new Error("Join a room first");
        const result = engine.submitAnswer(roomId, client.playerId, event.payload, Date.now());
        send(client, { type: "answer.result", payload: result } as ServerEvent);
        if (result.accepted) {
          const playerSnapshot = engine.snapshot(roomId, client.playerId);
          send(client, { type: "adaptive.updated", payload: { difficulty: playerSnapshot.adaptiveDifficulty, message: playerSnapshot.adaptiveMessage ?? "Difficulty is balanced" } });
        }
        if (result.accepted && engine.snapshot(roomId).room.phase === "round-results") finishRound(roomId);
        return;
      }
      throw new Error("Unsupported event");
    } catch (error) {
      send(client, { type: "error", payload: { code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Invalid request" } });
    }
  }

  function scheduleQuestionClose(roomId: string): void {
    const snapshot = engine.snapshot(roomId);
    const deadline = snapshot.room.questionDeadlineMs;
    if (deadline === undefined) return;
    const record = roomsById.get(roomId);
    if (!record) return;
    if (record.timer) clearTimeout(record.timer);
    record.timer = setTimeout(() => {
      try {
        if (engine.snapshot(roomId).room.phase === "question-active") finishRound(roomId);
      } catch (error) { broadcastError(roomId, error); }
    }, Math.max(0, deadline - Date.now()));
  }

  function finishRound(roomId: string): void {
    const record = roomsById.get(roomId);
    if (record?.timer) clearTimeout(record.timer);
    const currentPhase = engine.snapshot(roomId).room.phase;
    const result = currentPhase === "question-active" ? engine.closeQuestion(roomId) : engine.roundResult(roomId);
    if (!result) return;
    broadcast(roomId, { type: "round.results", payload: result });
    broadcastSnapshot(roomId);
    if (record) {
      record.advanceTimer = setTimeout(() => {
        try {
          const next = engine.advance(roomId, Date.now());
          if (next) {
            broadcastSnapshot(roomId);
            broadcastQuestion(roomId, next.questionId);
            scheduleQuestionClose(roomId);
          } else {
            broadcastSnapshot(roomId);
          }
        } catch (error) { broadcastError(roomId, error); }
      }, 2500);
    }
  }

  function broadcastQuestion(roomId: string, questionId: string): void {
    for (const client of clients) {
      if (client.roomId !== roomId || !client.playerId) continue;
      try {
        const snapshot = engine.snapshot(roomId, client.playerId);
        if (snapshot.currentQuestion?.questionId === questionId) send(client, { type: "question.started", payload: snapshot.currentQuestion });
      } catch (error) { send(client, { type: "error", payload: { code: "SNAPSHOT_FAILED", message: error instanceof Error ? error.message : "Could not load question" } }); }
    }
  }

  function broadcastSnapshot(roomId: string): void {
    for (const client of clients) {
      if (client.roomId !== roomId || !client.playerId) continue;
      try { send(client, { type: "room.snapshot", payload: engine.snapshot(roomId, client.playerId) }); } catch (error) { broadcastErrorToClient(client, error); }
    }
  }

  function broadcast(roomId: string, event: ServerEvent): void {
    for (const client of clients) if (client.roomId === roomId) send(client, event);
  }

  function broadcastError(roomId: string, error: unknown): void {
    for (const client of clients) if (client.roomId === roomId) broadcastErrorToClient(client, error);
  }

  function broadcastErrorToClient(client: ConnectedClient, error: unknown): void {
    send(client, { type: "error", payload: { code: "SERVER_ERROR", message: error instanceof Error ? error.message : "Server error" } });
  }

  function requireClientRoom(client: ConnectedClient, roomId: string): void {
    if (client.roomId !== roomId || !client.playerId) throw new Error("Join this room first");
  }

  for (const record of roomsById.values()) {
    const phase = engine.snapshot(record.roomId).room.phase;
    if (phase === "question-active") scheduleQuestionClose(record.roomId);
    if (phase === "round-results") {
      record.advanceTimer = setTimeout(() => {
        try {
          const next = engine.advance(record.roomId, Date.now());
          if (next) {
            broadcastSnapshot(record.roomId);
            broadcastQuestion(record.roomId, next.questionId);
            scheduleQuestionClose(record.roomId);
          }
        } catch (error) {
          broadcastError(record.roomId, error);
        }
      }, 2500);
    }
  }

  return {
    engine,
    httpServer,
    websocketServer,
    listen(port = options.port ?? Number(process.env.PORT ?? 3001)) {
      return new Promise<void>((resolve) => httpServer.listen(port, resolve));
    },
    close() {
      for (const record of roomsById.values()) {
        if (record.timer) clearTimeout(record.timer);
        if (record.advanceTimer) clearTimeout(record.advanceTimer);
      }
      websocketServer.close();
      return new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function send(client: ConnectedClient, event: ServerEvent): void {
  if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(event));
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
}

function sendError(response: ServerResponse, error: unknown): void {
  sendJson(response, 400, { error: error instanceof Error ? error.message : "Invalid request" });
}

function addCors(response: ServerResponse, origin: string): void {
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { data += chunk; if (data.length > 100_000) reject(new Error("Request body is too large")); });
    request.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { reject(new Error("Request body must be valid JSON")); } });
    request.on("error", reject);
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be an object");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function createRoomCode(existing: Map<string, RoomRecord>): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let code = "";
    for (let index = 0; index < 6; index += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!existing.has(code)) return code;
  }

  function createToken(prefix: string): string {
    return `${prefix}-${randomBytes(18).toString("hex")}`;
  }

  function loadServerState(path: string): RoomRecord[] {
    if (!existsSync(path)) return [];
    try {
      const state = JSON.parse(readFileSync(path, "utf8")) as RoomRecord[];
      return state.filter((record) => typeof record.roomId === "string" && typeof record.code === "string" && typeof record.hostToken === "string");
    } catch (error) {
      throw new Error(`Could not restore server state: ${error instanceof Error ? error.message : "invalid state file"}`);
    }
  }

  function persistServerState(path: string, records: Pick<RoomRecord, "roomId" | "code" | "hostToken">[]): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(records), "utf8");
  }

  function generateQuestionDrafts(topic: Question["topic"], difficulty: Question["difficulty"], count: number): Question[] {
    const templates: Record<Question["topic"], (index: number) => { text: string; options: string[]; correct: number; explanation: string }> = {
      quantitative: (index) => ({ text: `Practice ${index + 1}: What is the next number in the sequence 3, 6, 12, 24, ?`, options: ["36", "42", "48", "54"], correct: 2, explanation: "Each term is multiplied by two." }),
      logical: (index) => ({ text: `Logic ${index + 1}: If all A are B and all B are C, which statement must be true?`, options: ["All C are A", "All A are C", "No A are C", "Some C are not B"], correct: 1, explanation: "The transitive relationship means every A is also a C." }),
      verbal: (index) => ({ text: `Verbal ${index + 1}: Choose the closest meaning of 'concise'.`, options: ["Brief", "Confusing", "Loud", "Delayed"], correct: 0, explanation: "Concise means using few words." }),
      "data-interpretation": (index) => ({ text: `Data ${index + 1}: A value rises from 80 to 100. What is the percentage increase?`, options: ["20%", "25%", "80%", "125%"], correct: 1, explanation: "The increase is 20 over the original 80: 25%." }),
    };
    return Array.from({ length: count }, (_, index) => {
      const draft = templates[topic](index);
      return { id: `generated-${randomUUID()}`, text: draft.text, options: draft.options.map((text, optionIndex) => ({ id: String.fromCharCode(97 + optionIndex), text })), correctOptionId: String.fromCharCode(97 + draft.correct), topic, difficulty, timeLimitMs: difficulty === "hard" ? 15000 : difficulty === "easy" ? 25000 : 20000, explanation: draft.explanation };
    });
  }

  function parseTeams(value: unknown): Pick<Team, "id" | "name">[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 10) throw new Error("teams must be an array with at most 10 teams");
    return value.map((team, index) => {
      const item = asRecord(team);
      const name = requiredString(item.name, `teams[${index}].name`);
      return { id: `team-${index + 1}`, name };
    });
  }

  function parseQuestions(value: unknown): Question[] {
    if (!Array.isArray(value) || value.length > 50) throw new Error("customQuestions must be an array with at most 50 questions");
    const questions = value.map((candidate, index) => {
      const item = asRecord(candidate);
      const options = item.options;
      if (!Array.isArray(options) || options.length < 2 || options.length > 6) throw new Error(`customQuestions[${index}].options must contain 2 to 6 options`);
      const parsedOptions = options.map((option, optionIndex) => {
        const parsed = asRecord(option);
        return { id: requiredString(parsed.id, `customQuestions[${index}].options[${optionIndex}].id`), text: requiredString(parsed.text, `customQuestions[${index}].options[${optionIndex}].text`) };
      });
      const topic = requiredString(item.topic, `customQuestions[${index}].topic`);
      const difficulty = requiredString(item.difficulty, `customQuestions[${index}].difficulty`);
      const correctOptionId = requiredString(item.correctOptionId, `customQuestions[${index}].correctOptionId`);
      if (!isTopic(topic) || !isDifficulty(difficulty) || !parsedOptions.some((option) => option.id === correctOptionId)) throw new Error(`customQuestions[${index}] has invalid topic, difficulty or correct option`);
      if (new Set(parsedOptions.map((option) => option.id)).size !== parsedOptions.length) throw new Error(`customQuestions[${index}] has duplicate option IDs`);
      return {
        id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `custom-question-${index + 1}`,
        text: requiredString(item.text, `customQuestions[${index}].text`),
        options: parsedOptions,
        correctOptionId,
        topic,
        difficulty,
        timeLimitMs: typeof item.timeLimitMs === "number" && item.timeLimitMs >= 5000 && item.timeLimitMs <= 300000 ? item.timeLimitMs : 20000,
        imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : undefined,
        tableMarkdown: typeof item.tableMarkdown === "string" ? item.tableMarkdown : undefined,
        explanation: typeof item.explanation === "string" ? item.explanation : undefined,
      };
    });
    if (new Set(questions.map((question) => question.id)).size !== questions.length) throw new Error("customQuestions contains duplicate question IDs");
    return questions;
  }
  throw new Error("Could not allocate a room code");
}