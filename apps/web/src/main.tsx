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
  CollegeLeagueEntry,
} from "@aptiquiz/contracts";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const WS_URL = import.meta.env.VITE_WS_URL ?? API_URL.replace(/^http/, "ws");

type View = "join" | "lobby" | "question" | "results" | "complete";
type Section = "live" | "practice" | "generator" | "analytics" | "leaderboard" | "league" | "achievements" | "profile";

function App() {
  const [view, setView] = useState<View>("join");
  const [section, setSection] = useState<Section>("live");
  const [lightTheme, setLightTheme] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [collegeId, setCollegeId] = useState("demo-college");
  const [teamId, setTeamId] = useState("");
  const [teamMode, setTeamMode] = useState(false);
  const [clutchRound, setClutchRound] = useState(false);
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
  const [reconnecting, setReconnecting] = useState(false);
  const [adaptiveMessage, setAdaptiveMessage] = useState("");
  const [hostAnalytics, setHostAnalytics] = useState<HostAnalytics>();
  const [collegeLeague, setCollegeLeague] = useState<CollegeLeagueEntry[]>([]);

  useEffect(() => {
    if (!socket) return;
    const onOpen = () => {
      setConnected(true);
      setReconnecting(false);
    };
    const onClose = () => {
      setConnected(false);
      if (sessionToken && roomCode) {
        setReconnecting(true);
        window.setTimeout(() => {
          join(roomCode);
          setReconnecting(false);
        }, 1000);
      }
    };
    const onMessage = (message: MessageEvent<string>) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(message.data) as ServerEvent;
      } catch {
        setError("Received an invalid message from the game server.");
        return;
      }
      if (event.type === "room.snapshot") {
        setSnapshot(event.payload);
        setRoomId(event.payload.room.id);
        setQuestion(event.payload.currentQuestion);
        setRoundResult(event.payload.currentRoundResult);
        setView(event.payload.room.phase === "complete" ? "complete" : event.payload.room.phase === "question-active" ? "question" : event.payload.room.phase === "round-results" && event.payload.currentRoundResult ? "results" : "lobby");
      }
      if (event.type === "player.reconnected") {
        setPlayerId(event.payload.playerId);
        if (event.payload.sessionToken) {
          setSessionToken(event.payload.sessionToken);
          localStorage.setItem("aptiquiz-session", event.payload.sessionToken);
        }
        if (event.payload.hostToken) {
          setHostToken(event.payload.hostToken);
          localStorage.setItem("aptiquiz-host-token", event.payload.hostToken);
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
          clutchRound,
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
      const response = await fetch(`${API_URL}/rooms/${roomId}/analytics`, { headers: { "x-host-token": hostToken } });
      if (response.ok) setHostAnalytics(await response.json() as HostAnalytics);
    }
    if (next === "league") {
      const response = await fetch(`${API_URL}/league?period=all-time`);
      if (response.ok) setCollegeLeague(await response.json() as CollegeLeagueEntry[]);
    }
  };

  return (
    <main className={lightTheme ? "app-shell light-theme" : "app-shell"}>
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark">A</span><span>AptiQuiz</span></div>
        <div className="topbar-actions"><button className="theme-toggle" onClick={() => setLightTheme((current) => !current)}>{lightTheme ? "Dark" : "Light"} mode</button><div className="status-pill"><span className={connected ? "status-dot online" : "status-dot"} />{reconnecting ? "Reconnecting..." : connected ? "Live arena" : "Not connected"}</div></div>
      </header>
      <nav className="dashboard-nav" aria-label="Main navigation">{(["live", "practice", "generator", "analytics", "leaderboard", "league", "achievements", "profile"] as Section[]).map((item) => <button key={item} className={section === item ? "nav-item active" : "nav-item"} onClick={() => changeSection(item)}>{item === "live" ? "Live Quiz" : item === "generator" ? "AI Generator" : item === "leaderboard" ? "Leaderboard" : item === "league" ? "College League" : item[0].toUpperCase() + item.slice(1)}</button>)}</nav>
      <div className="content-grid">
        <section className="main-column">
          {error && <div className="alert" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
          {section === "live" && <>
            {view === "join" && <JoinView displayName={displayName} setDisplayName={setDisplayName} roomCode={roomCode} setRoomCode={setRoomCode} collegeId={collegeId} setCollegeId={setCollegeId} teamId={teamId} setTeamId={setTeamId} teamMode={teamMode} setTeamMode={setTeamMode} teamNames={teamNames} setTeamNames={setTeamNames} clutchRound={clutchRound} setClutchRound={setClutchRound} customQuestions={customQuestions} setCustomQuestions={setCustomQuestions} onJoin={() => join()} onCreate={createRoom} isCreating={isCreating} />}
            {view === "lobby" && snapshot && <LobbyView snapshot={snapshot} onStart={startGame} />}
            {view === "question" && question && <QuestionView question={question} lastAnswer={lastAnswer} adaptiveMessage={adaptiveMessage || snapshot?.adaptiveMessage} onAnswer={submitAnswer} />}
            {view === "results" && roundResult && <ResultsView result={roundResult} analytics={snapshot?.analytics} onWait={() => setView("lobby")} />}
            {view === "complete" && <CompleteView leaderboard={leaderboard} analytics={snapshot?.analytics} />}
          </>}
          {section !== "live" && <DashboardSection section={section} analytics={snapshot?.analytics} hostAnalytics={hostAnalytics} leaderboard={leaderboard} collegeLeague={collegeLeague} />}
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
  clutchRound: boolean; setClutchRound: (value: boolean) => void;
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
      <label className="checkbox-label"><input type="checkbox" checked={props.clutchRound} onChange={(event) => props.setClutchRound(event.target.checked)} /> Add final 3-question Clutch Round (+50%)</label>
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

function QuestionView({ question, lastAnswer, adaptiveMessage, onAnswer }: { question: PlayerQuestion; lastAnswer?: AnswerResult; adaptiveMessage?: string; onAnswer: (optionId: string) => void }) {
  const [remaining, setRemaining] = useState(Math.ceil((question.deadlineMs - Date.now()) / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(Math.max(0, Math.ceil((question.deadlineMs - Date.now()) / 1000))), 250);
    return () => window.clearInterval(timer);
  }, [question]);
  const progress = Math.max(0, Math.min(100, ((question.deadlineMs - Date.now()) / question.timeLimitMs) * 100));
  return <div className="panel question-panel">
    <div className="question-meta"><span className="question-count">QUESTION IN PROGRESS</span><span className="topic-tag">{question.topic.replace("-", " ")}</span><span className="difficulty-tag">{question.difficulty}</span>{question.isClutch && <span className="clutch-tag">🔥 CLUTCH +50%</span>}</div>
    {adaptiveMessage && <div className="adaptive-banner">✦ {adaptiveMessage}</div>}
    <div className="timer-block"><span className="timer-label">TIME LEFT</span><strong>{String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}</strong><div className="timer-track"><span style={{ width: `${progress}%` }} /></div></div>
    <h2 className="question-text">{question.text}</h2>
    <div className="options-grid">{question.options.map((option, index) => <button className={`option-button ${lastAnswer ? "answered" : ""}`} disabled={Boolean(lastAnswer)} onClick={() => onAnswer(option.id)} key={option.id}><span className="option-key">{String.fromCharCode(65 + index)}</span><span>{option.text}</span></button>)}</div>
    <div className="server-note"><span className="server-icon">◉</span> The server is the referee. Your answer is scored when it reaches the arena.</div>
  </div>;
}

function ResultsView({ result, analytics, onWait }: { result: RoundResult; analytics?: GameSnapshot["analytics"]; onWait: () => void }) {
  return <div className="panel results-panel">
    <div className="eyebrow">ROUND COMPLETE</div><h2>Nice work. Here’s the breakdown.</h2>
    <div className="answer-reveal">Correct answer <strong>{result.correctOptionId.toUpperCase()}</strong></div>
    <div className="result-list">{result.results.map((answer) => <div className="result-row" key={answer.playerId}><span>{answer.playerId}</span><span className={answer.correct ? "correct" : "muted"}>{answer.correct ? `+${answer.score}` : "No points"}</span></div>)}</div>
    <button className="secondary-button wide" onClick={onWait}>View leaderboard <span>→</span></button>
    {analytics && <AnalyticsSummary analytics={analytics} />}
  </div>;
}

function CompleteView({ leaderboard, analytics }: { leaderboard: LeaderboardEntry[]; analytics?: GameSnapshot["analytics"] }) {
  return <div className="panel results-panel"><div className="eyebrow">ARENA COMPLETE</div><h2>YOUR PERFORMANCE</h2>{analytics && <AnalyticsSummary analytics={analytics} />}<Leaderboard entries={leaderboard} /><button className="primary-button wide">Practice again <span>→</span></button></div>;
}

function AnalyticsSummary({ analytics }: { analytics: GameSnapshot["analytics"] }) {
  const topicLabels = { quantitative: "Quantitative", logical: "Logical", verbal: "Verbal", "data-interpretation": "Data interpretation" };
  return <div className="analytics-summary">
    <div className="readiness-card"><div className="eyebrow">PLACEMENT READINESS</div><strong>{analytics.readiness.score}<small>/100</small></strong><p>Accuracy {analytics.readiness.accuracy}% · Speed {analytics.readiness.speed}% · Consistency {analytics.readiness.consistency}%</p></div>
    <div className="metric-grid"><Metric label="Accuracy" value={`${Math.round(analytics.accuracy * 100)}%`} /><Metric label="Avg response" value={analytics.averageResponseTimeMs ? `${(analytics.averageResponseTimeMs / 1000).toFixed(1)}s` : "—"} /><Metric label="Attempted" value={`${analytics.attempted}`} /><Metric label="Correct" value={`${analytics.correct}`} /></div>
    <div className="balance-card"><div className="eyebrow">SPEED VS ACCURACY</div><div className="balance-row"><span>Accuracy</span><div><i style={{ width: `${analytics.readiness.accuracy}%` }} /></div><b>{analytics.readiness.accuracy}%</b></div><div className="balance-row"><span>Speed</span><div><i style={{ width: `${analytics.readiness.speed}%` }} /></div><b>{analytics.readiness.speed}%</b></div><div className="balance-row"><span>Consistency</span><div><i style={{ width: `${analytics.readiness.consistency}%` }} /></div><b>{analytics.readiness.consistency}%</b></div></div>
    <div className="radar-card"><div className="eyebrow">PERSONALIZED PERFORMANCE</div><div className="radar-chart">{(Object.keys(analytics.topics) as Array<keyof typeof analytics.topics>).map((topic, index) => <div className="radar-axis" style={{ transform: `rotate(${index * 90}deg)` }} key={topic}><span style={{ transform: `rotate(${-index * 90}deg)` }}>{topicLabels[topic]}</span><i style={{ height: `${Math.round((analytics.topics[topic].attempted ? analytics.topics[topic].correct / analytics.topics[topic].attempted : 0) * 100)}%` }} /></div>)}</div></div>
    <div className="insight-card"><strong>What to improve</strong><p>{analytics.accuracy >= .8 ? "Your accuracy is strong, but your average solving speed can improve." : "Build accuracy first, then gradually increase your solving speed."}</p><span>Recommended next: {analytics.recommendations.map((topic) => topicLabels[topic]).join(", ") || "Complete a few more questions"}</span></div>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function DashboardSection({ section, analytics, hostAnalytics, leaderboard, collegeLeague }: { section: Section; analytics?: GameSnapshot["analytics"]; hostAnalytics?: HostAnalytics; leaderboard: LeaderboardEntry[]; collegeLeague: CollegeLeagueEntry[] }) {
  const title = section === "generator" ? "AI Question Generator" : section === "league" ? "College League" : section[0].toUpperCase() + section.slice(1);
  return <div className="panel dashboard-panel"><div className="eyebrow">APTIQUIZ DASHBOARD</div><h2>{title}</h2>{section === "analytics" && hostAnalytics ? <><div className="metric-grid four"><Metric label="Participants" value={`${hostAnalytics.participants}`} /><Metric label="Avg score" value={`${hostAnalytics.averageScore}`} /><Metric label="Avg accuracy" value={`${Math.round(hostAnalytics.averageAccuracy * 100)}%`} /><Metric label="Avg response" value={hostAnalytics.averageResponseTimeMs ? `${(hostAnalytics.averageResponseTimeMs / 1000).toFixed(1)}s` : "—"} /></div><h3>Topic-wise performance</h3><TopicBars topics={hostAnalytics.topics} /><button className="secondary-button" onClick={() => downloadJson(hostAnalytics, "aptiquiz-analytics.json")}>Export results</button></> : section === "league" ? <LeagueTable entries={collegeLeague} /> : section === "leaderboard" ? <Leaderboard entries={leaderboard} /> : section === "generator" ? <GeneratorCard /> : section === "profile" && analytics ? <AnalyticsSummary analytics={analytics} /> : section === "achievements" ? <AchievementBadges analytics={analytics} /> : <DashboardEmpty section={section} analytics={analytics} />}</div>;
}

function AchievementBadges({ analytics }: { analytics?: GameSnapshot["analytics"] }) {
  const badges = [
    ["🎯 Accuracy King", Boolean(analytics && analytics.accuracy >= .8)],
    ["⚡ Speed Master", Boolean(analytics && analytics.readiness.speed >= 75)],
    ["🧠 Logic Master", Boolean(analytics && analytics.topics.logical.correct >= 3)],
    ["📈 Improving Fast", Boolean(analytics && analytics.readiness.consistency >= 70)],
  ];
  return <div className="badge-grid">{badges.map(([label, unlocked]) => <div className={unlocked ? "badge unlocked" : "badge"} key={label}><span>{label}</span><small>{unlocked ? "Unlocked from your results" : "Keep playing to unlock"}</small></div>)}</div>;
}

function LeagueTable({ entries }: { entries: CollegeLeagueEntry[] }) {
  return <div className="league-table"><div className="league-head"><span>Rank</span><span>College</span><span>Points</span><span>Participants</span></div>{entries.length ? entries.map((entry) => <div className="league-row" key={entry.collegeId}><strong>#{entry.rank}</strong><span>{entry.collegeId}</span><b>{entry.points}</b><span>{entry.participants}</span></div>) : <div className="draft-placeholder">Complete a quiz to enter the college league.</div>}</div>;
}

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function TopicBars({ topics }: { topics: GameSnapshot["analytics"]["topics"] }) {
  return <div className="topic-bars">{(Object.entries(topics) as Array<[keyof typeof topics, typeof topics[keyof typeof topics]]>).map(([topic, stats]) => <div key={topic}><span>{topic.replace("-", " ")}</span><div><i style={{ width: `${stats.attempted ? (stats.correct / stats.attempted) * 100 : 0}%` }} /></div><b>{stats.attempted ? Math.round((stats.correct / stats.attempted) * 100) : 0}%</b></div>)}</div>;
}

function GeneratorCard() {
  const [topic, setTopic] = useState("quantitative");
  const [difficulty, setDifficulty] = useState("medium");
  const [count, setCount] = useState(5);
  const [drafts, setDrafts] = useState<Array<{ id: string; text: string; options: Array<{ id: string; text: string }>; correctOptionId: string; explanation?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const generate = async () => {
    setLoading(true);
    const response = await fetch(`${API_URL}/question-generator`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic, difficulty, count }) });
    if (response.ok) setDrafts((await response.json() as { questions: typeof drafts }).questions);
    setLoading(false);
  };
  return <div className="generator-card"><p>Generate question drafts, review the answer and explanation, then copy approved questions into the room creator. The server remains the source of truth for scoring.</p><div className="generator-controls"><select value={topic} onChange={(event) => setTopic(event.target.value)}><option>quantitative</option><option>logical</option><option>verbal</option><option>data-interpretation</option></select><select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option>easy</option><option>medium</option><option>hard</option></select><input type="number" min="1" max="20" value={count} onChange={(event) => setCount(Number(event.target.value))} /><button className="primary-button" onClick={generate} disabled={loading}>{loading ? "Generating..." : "Generate drafts"}</button></div>{drafts.length === 0 ? <div className="draft-placeholder">Question drafts will appear here for review and approval.</div> : <div className="draft-list">{drafts.map((draft) => <article className="draft-card" key={draft.id}><strong>{draft.text}</strong><div>{draft.options.map((option) => <span className={option.id === draft.correctOptionId ? "draft-option correct" : "draft-option"} key={option.id}>{option.id.toUpperCase()}. {option.text}</span>)}</div><p>{draft.explanation}</p><button className="secondary-button">Approve draft</button></article>)}</div>}</div>;
}

function DashboardEmpty({ section, analytics }: { section: Section; analytics?: GameSnapshot["analytics"] }) {
  return <div className="dashboard-empty"><div className="empty-icon">✦</div><h3>{section === "achievements" ? "Achievements unlock from real performance" : section === "league" ? "College rankings are ready for eligible quiz results" : "Keep playing to unlock this view"}</h3>{analytics && <AnalyticsSummary analytics={analytics} />}</div>;
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
