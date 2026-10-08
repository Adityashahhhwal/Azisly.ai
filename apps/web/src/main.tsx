import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  AnswerResult,
  GameSnapshot,
  LeaderboardEntry,
  PlayerQuestion,
  RoundResult,
  ServerEvent,
  HostAnalytics,
} from "@aptiquiz/contracts";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const WS_URL = import.meta.env.VITE_WS_URL ?? API_URL.replace(/^http/, "ws");

type View = "join" | "lobby" | "question" | "results" | "complete";
type Section = "live" | "practice" | "generator" | "analytics" | "leaderboard" | "league" | "achievements" | "profile";

function App() {
  const [view, setView] = useState<View>("join");
  const [section, setSection] = useState<Section>("live");
  const [roomCode, setRoomCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [collegeId, setCollegeId] = useState("demo-college");
  const [teamId, setTeamId] = useState("");
  const [teamMode, setTeamMode] = useState(false);
  const [teamNames, setTeamNames] = useState("Red Team, Blue Team");
  const [customQuestions, setCustomQuestions] = useState("");
  const [roomId, setRoomId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem("aptiquiz-session") ?? "");
  const [hostToken, setHostToken] = useState(() => localStorage.getItem("aptiquiz-host-token") ?? "");
  const [snapshot, setSnapshot] = useState<GameSnapshot>();
  const [question, setQuestion] = useState<PlayerQuestion>();
  const [roundResult, setRoundResult] = useState<RoundResult>();
  const [lastAnswer, setLastAnswer] = useState<AnswerResult>();
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<WebSocket>();
  const [isCreating, setIsCreating] = useState(false);
  const [adaptiveMessage, setAdaptiveMessage] = useState("");
  const [hostAnalytics, setHostAnalytics] = useState<HostAnalytics>();

  useEffect(() => {
    if (!socket) return;
    const onOpen = () => setConnected(true);
    const onClose = () => setConnected(false);
    const onMessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as ServerEvent;
      if (event.type === "room.snapshot") {
        setSnapshot(event.payload);
        setRoomId(event.payload.room.id);
        setQuestion(event.payload.currentQuestion);
        setView(event.payload.room.phase === "complete" ? "complete" : event.payload.room.phase === "question-active" ? "question" : "lobby");
      }
      if (event.type === "player.reconnected") {
        setPlayerId(event.payload.playerId);
        if (event.payload.sessionToken) {
          setSessionToken(event.payload.sessionToken);
          localStorage.setItem("aptiquiz-session", event.payload.sessionToken);
        }
      }
      if (event.type === "question.started") {
        setQuestion(event.payload);
        setRoundResult(undefined);
        setLastAnswer(undefined);
        setView("question");
      }
      if (event.type === "answer.result") setLastAnswer(event.payload);
      if (event.type === "adaptive.updated") setAdaptiveMessage(event.payload.message);
      if (event.type === "round.results") {
        setRoundResult(event.payload);
        setView("results");
      }
      if (event.type === "error") setError(event.payload.message);
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    socket.addEventListener("message", onMessage);
    return () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("message", onMessage);
    };
  }, [socket]);

  const connect = () => {
    if (socket?.readyState === WebSocket.OPEN) return socket;
    const next = new WebSocket(WS_URL);
    setSocket(next);
    return next;
  };

  const send = (event: object) => {
    const active = socket;
    if (!active || active.readyState !== WebSocket.OPEN) {
      setError("The game server is not connected yet.");
      return;
    }
    active.send(JSON.stringify(event));
  };

  const join = (code = roomCode, hostTokenOverride = hostToken) => {
    setError("");
    const active = connect();
    const message = JSON.stringify({
      type: "room.join",
      roomCode: code.trim().toUpperCase(),
      displayName: displayName.trim(),
      collegeId: collegeId.trim(),
      sessionToken: sessionToken || undefined,
      teamId: teamId.trim() || undefined,
      hostToken: hostTokenOverride || undefined,
    });
    if (active.readyState === WebSocket.OPEN) active.send(message);
    else active.addEventListener("open", () => active.send(message), { once: true });
  };

  const createRoom = async () => {
    setError("");
    setIsCreating(true);
    try {
      const response = await fetch(`${API_URL}/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          collegeId,
          questionSetId: "booklet-2026-starter",
          teamMode,
          teams: teamMode ? teamNames.split(",").map((name) => ({ name: name.trim() })).filter((team) => team.name) : undefined,
          customQuestions: customQuestions.trim() ? JSON.parse(customQuestions) : undefined,
        }),
      });
      const result = await response.json() as { code?: string; id?: string; error?: string };
      if (!response.ok || !result.code) throw new Error(result.error ?? "Could not create room");
      const createdHostToken = (result as { hostToken?: string }).hostToken ?? "";
      setHostToken(createdHostToken);
      localStorage.setItem("aptiquiz-host-token", createdHostToken);
      setRoomCode(result.code);
      join(result.code, (result as { hostToken?: string }).hostToken ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create room");
    } finally {
      setIsCreating(false);
    }
  };

  const startGame = () => {
    if (roomId) send({ type: "game.start", roomId });
  };

  const submitAnswer = (optionId: string) => {
    if (!roomId || !question || lastAnswer) return;
    send({ type: "answer.submit", payload: { roomId, questionId: question.questionId, optionId } });
  };

  const leaderboard = roundResult?.leaderboard ?? snapshot?.leaderboard ?? [];
  const currentPlayer = leaderboard.find((entry) => entry.playerId === playerId);
  const changeSection = async (next: Section) => {
    setSection(next);
    if (next === "analytics" && roomId) {
      const response = await fetch(`${API_URL}/rooms/${roomId}/analytics`);
      if (response.ok) setHostAnalytics(await response.json() as HostAnalytics);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark">A</span><span>AptiQuiz</span></div>
        <div className="status-pill"><span className={connected ? "status-dot online" : "status-dot"} />{connected ? "Live arena" : "Not connected"}</div>
      </header>
      <nav className="dashboard-nav" aria-label="Main navigation">{(["live", "practice", "generator", "analytics", "leaderboard", "league", "achievements", "profile"] as Section[]).map((item) => <button key={item} className={section === item ? "nav-item active" : "nav-item"} onClick={() => changeSection(item)}>{item === "live" ? "Live Quiz" : item === "generator" ? "AI Generator" : item === "leaderboard" ? "Leaderboard" : item === "league" ? "College League" : item[0].toUpperCase() + item.slice(1)}</button>)}</nav>
      <div className="content-grid">
        <section className="main-column">
          {error && <div className="alert" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
          {section === "live" && <>
            {view === "join" && <JoinView displayName={displayName} setDisplayName={setDisplayName} roomCode={roomCode} setRoomCode={setRoomCode} collegeId={collegeId} setCollegeId={setCollegeId} teamId={teamId} setTeamId={setTeamId} teamMode={teamMode} setTeamMode={setTeamMode} teamNames={teamNames} setTeamNames={setTeamNames} customQuestions={customQuestions} setCustomQuestions={setCustomQuestions} onJoin={() => join()} onCreate={createRoom} isCreating={isCreating} />}
            {view === "lobby" && snapshot && <LobbyView snapshot={snapshot} onStart={startGame} />}
            {view === "question" && question && <QuestionView question={question} lastAnswer={lastAnswer} adaptiveMessage={adaptiveMessage || snapshot?.adaptiveMessage} onAnswer={submitAnswer} />}
            {view === "results" && roundResult && <ResultsView result={roundResult} analytics={snapshot?.analytics} onWait={() => setView("lobby")} />}
            {view === "complete" && <CompleteView leaderboard={leaderboard} analytics={snapshot?.analytics} />}
          </>}
          {section !== "live" && <DashboardSection section={section} analytics={snapshot?.analytics} hostAnalytics={hostAnalytics} leaderboard={leaderboard} />}
        </section>
        <aside className="side-column">
          <ArenaRail view={view} snapshot={snapshot} currentPlayer={currentPlayer} leaderboard={leaderboard} />
        </aside>
      </div>
    </main>
  );
}

function JoinView(props: {
  displayName: string; setDisplayName: (value: string) => void;
  roomCode: string; setRoomCode: (value: string) => void;
  collegeId: string; setCollegeId: (value: string) => void;
  teamId: string; setTeamId: (value: string) => void;
  teamMode: boolean; setTeamMode: (value: boolean) => void;
  teamNames: string; setTeamNames: (value: string) => void;
  customQuestions: string; setCustomQuestions: (value: string) => void;
  onJoin: () => void; onCreate: () => void; isCreating: boolean;
}) {
  return <div className="hero-card">
    <div className="eyebrow">PLACEMENT PRACTICE / LIVE ARENA</div>
    <h1>Train under pressure.<br /><span>Climb the board.</span></h1>
    <p className="hero-copy">Race through aptitude and reasoning questions with your cohort. Speed matters, but accuracy comes first.</p>
    <div className="form-card">
      <label>Display name<input value={props.displayName} onChange={(event) => props.setDisplayName(event.target.value)} placeholder="e.g. Asha Sharma" /></label>
      <label>College ID<input value={props.collegeId} onChange={(event) => props.setCollegeId(event.target.value)} placeholder="demo-college" /></label>
      <label>Room code<input className="code-input" value={props.roomCode} onChange={(event) => props.setRoomCode(event.target.value.toUpperCase())} placeholder="ABC123" maxLength={6} /></label>
      <label>Team ID (optional)<input value={props.teamId} onChange={(event) => props.setTeamId(event.target.value)} placeholder="team-1" /></label>
      <label className="checkbox-label"><input type="checkbox" checked={props.teamMode} onChange={(event) => props.setTeamMode(event.target.checked)} /> Enable team contest</label>
      {props.teamMode && <label>Team names<input value={props.teamNames} onChange={(event) => props.setTeamNames(event.target.value)} placeholder="Red Team, Blue Team" /></label>}
      <label className="custom-question-field">Custom questions JSON (optional)<textarea value={props.customQuestions} onChange={(event) => props.setCustomQuestions(event.target.value)} placeholder='[{"text":"...","options":[{"id":"a","text":"..."}],"correctOptionId":"a","topic":"logical","difficulty":"easy"}]' /></label>
      <button className="primary-button" disabled={!props.displayName || !props.roomCode} onClick={props.onJoin}>Join arena <span>→</span></button>
      <div className="or-divider"><span>or</span></div>
      <button className="secondary-button" disabled={!props.displayName || props.isCreating} onClick={props.onCreate}>{props.isCreating ? "Creating room..." : "Create demo room"}</button>
    </div>
    <div className="trust-row"><span>✓ Server-timed</span><span>✓ Fair scoring</span><span>✓ No account required</span></div>
  </div>;
}

function LobbyView({ snapshot, onStart }: { snapshot: GameSnapshot; onStart: () => void }) {
  return <div className="panel lobby-panel">
    <div className="panel-heading"><div><div className="eyebrow">ROOM {snapshot.room.code}</div><h2>Waiting room</h2></div><span className="phase-tag">Ready to play</span></div>
    <p className="muted">Share the code with your cohort. The host can start when everyone is ready.</p>
    <div className="room-code">{snapshot.room.code}</div>
    {snapshot.room.teamMode && <div className="team-chips">{snapshot.room.teams.map((team) => <span key={team.id}>{team.id}: {team.name}</span>)}</div>}
    <div className="player-list">{snapshot.room.players.map((player) => <div className="player-row" key={player.id}><span className="avatar">{player.displayName.slice(0, 1).toUpperCase()}</span><span>{player.displayName}</span>{player.teamId && <span className="team-tag">{player.teamId}</span>}<span className={player.connected ? "connection live" : "connection"}>{player.connected ? "Connected" : "Away"}</span></div>)}</div>
    <button className="primary-button wide" onClick={onStart}>Start game <span>→</span></button>
  </div>;
}

function QuestionView({ question, lastAnswer, onAnswer }: { question: PlayerQuestion; lastAnswer?: AnswerResult; onAnswer: (optionId: string) => void }) {
  const [remaining, setRemaining] = useState(Math.ceil((question.deadlineMs - Date.now()) / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(Math.max(0, Math.ceil((question.deadlineMs - Date.now()) / 1000))), 250);
    return () => window.clearInterval(timer);
  }, [question]);
  const progress = Math.max(0, Math.min(100, ((question.deadlineMs - Date.now()) / question.timeLimitMs) * 100));
  return <div className="panel question-panel">
    <div className="question-meta"><span className="question-count">QUESTION IN PROGRESS</span><span className="topic-tag">{question.topic.replace("-", " ")}</span><span className="difficulty-tag">{question.difficulty}</span></div>
    <div className="timer-block"><span className="timer-label">TIME LEFT</span><strong>{String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}</strong><div className="timer-track"><span style={{ width: `${progress}%` }} /></div></div>
    <h2 className="question-text">{question.text}</h2>
    <div className="options-grid">{question.options.map((option, index) => <button className={`option-button ${lastAnswer ? "answered" : ""}`} disabled={Boolean(lastAnswer)} onClick={() => onAnswer(option.id)} key={option.id}><span className="option-key">{String.fromCharCode(65 + index)}</span><span>{option.text}</span></button>)}</div>
    <div className="server-note"><span className="server-icon">◉</span> The server is the referee. Your answer is scored when it reaches the arena.</div>
  </div>;
}

function ResultsView({ result, onWait }: { result: RoundResult; onWait: () => void }) {
  return <div className="panel results-panel">
    <div className="eyebrow">ROUND COMPLETE</div><h2>Nice work. Here’s the breakdown.</h2>
    <div className="answer-reveal">Correct answer <strong>{result.correctOptionId.toUpperCase()}</strong></div>
    <div className="result-list">{result.results.map((answer) => <div className="result-row" key={answer.playerId}><span>{answer.playerId}</span><span className={answer.correct ? "correct" : "muted"}>{answer.correct ? `+${answer.score}` : "No points"}</span></div>)}</div>
    <button className="secondary-button wide" onClick={onWait}>View leaderboard <span>→</span></button>
  </div>;
}

function CompleteView({ leaderboard }: { leaderboard: LeaderboardEntry[] }) {
  return <div className="panel results-panel"><div className="eyebrow">ARENA COMPLETE</div><h2>Final standings</h2><Leaderboard entries={leaderboard} /></div>;
}

function ArenaRail({ view, snapshot, currentPlayer, leaderboard }: { view: View; snapshot?: GameSnapshot; currentPlayer?: LeaderboardEntry; leaderboard: LeaderboardEntry[] }) {
  return <><div className="rail-card score-card"><div className="eyebrow">YOUR SESSION</div><div className="score-number">{currentPlayer?.totalScore ?? 0}</div><div className="muted">total points</div><div className="score-stats"><span><strong>{currentPlayer?.accuracy ? `${Math.round(currentPlayer.accuracy * 100)}%` : "—"}</strong> accuracy</span><span><strong>{currentPlayer?.averageResponseTimeMs ? `${(currentPlayer.averageResponseTimeMs / 1000).toFixed(1)}s` : "—"}</strong> avg speed</span></div></div><div className="rail-card"><div className="rail-heading"><span>LIVE LEADERBOARD</span><span className="live-label">● LIVE</span></div><Leaderboard entries={leaderboard.slice(0, 5)} />{snapshot?.room.teamMode && <><div className="rail-heading team-heading"><span>TEAM LEADERBOARD</span></div><TeamLeaderboard entries={snapshot.teamLeaderboard} /></>}</div><div className="rail-card rules-card"><div className="eyebrow">HOW IT WORKS</div><p><strong>Fast + correct = more points.</strong> The server controls the timer, checks the answer and updates the board fairly for everyone.</p><div className="phase-progress"><span className={view !== "join" ? "active" : ""}>Join</span><span className={["question", "results", "complete"].includes(view) ? "active" : ""}>Play</span><span className={["results", "complete"].includes(view) ? "active" : ""}>Results</span></div></div></>;
}

function TeamLeaderboard({ entries }: { entries: GameSnapshot["teamLeaderboard"] }) {
  return <div className="leaderboard">{entries.map((entry) => <div className="leader-row" key={entry.id}><span className="rank">{entry.rank}</span><span className="leader-name">{entry.name}</span><span className="muted">{entry.memberCount} players</span><strong>{entry.totalScore}</strong></div>)}</div>;
}

function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  return <div className="leaderboard">{entries.map((entry) => <div className="leader-row" key={entry.playerId}><span className="rank">{entry.rank}</span><span className="mini-avatar">{entry.displayName.slice(0, 1).toUpperCase()}</span><span className="leader-name">{entry.displayName}</span><strong>{entry.totalScore}</strong>{entry.rankMovement > 0 && <span className="movement up">↑{entry.rankMovement}</span>}</div>)}</div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
