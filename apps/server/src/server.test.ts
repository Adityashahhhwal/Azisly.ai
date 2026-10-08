import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { createAptiQuizServer } from "./server.js";

async function startFixture(context: TestContext) {
  const dataDirectory = mkdtempSync(join(tmpdir(), "aptiquiz-server-test-"));
  const server = createAptiQuizServer({ dataDirectory });
  await server.listen(0);
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sockets = new Set<WebSocket>();
  context.after(async () => {
    await Promise.all([...sockets].map((socket) => closeSocket(socket)));
    await server.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  });
  return {
    server,
    baseUrl,
    connect() {
      const socket = new WebSocket(baseUrl.replace(/^http/, "ws"));
      sockets.add(socket);
      return socket;
    },
  };
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    if (socket.readyState === WebSocket.CONNECTING) socket.once("open", () => socket.close());
    else socket.close();
    const timeout = setTimeout(() => {
      socket.terminate();
      resolve();
    }, 1_000);
    timeout.unref();
  });
}

function waitForEvent(socket: WebSocket, type: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Timed out waiting for ${type}`));
    }, 2_000);
    const onMessage = (raw: WebSocket.RawData) => {
      const event = JSON.parse(raw.toString()) as Record<string, any>;
      if (event.type !== type) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(event);
    };
    socket.on("message", onMessage);
  });
}

async function createRoom(baseUrl: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`${baseUrl}/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ collegeId: "test-college", ...body }),
  });
  return { response, payload: await response.json() as Record<string, any> };
}

test("creates rooms with validated teams and exposes only public join details", async (context) => {
  const { baseUrl } = await startFixture(context);
  const invalid = await createRoom(baseUrl, { teamMode: true, teams: [{ name: "Only team" }] });
  assert.equal(invalid.response.status, 400);

  const room = await createRoom(baseUrl, {
    teamMode: true,
    clutchRound: true,
    teams: [{ name: "Red" }, { name: "Blue" }],
  });
  assert.equal(room.response.status, 201);
  assert.match(room.payload.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(typeof room.payload.hostToken, "string");

  const lookup = await fetch(`${baseUrl}/rooms/${room.payload.code.toLowerCase()}?from=join-form`);
  assert.equal(lookup.status, 200);
  const publicDetails = await lookup.json() as Record<string, any>;
  assert.equal(publicDetails.teamMode, true);
  assert.deepEqual(publicDetails.teams.map((team: { name: string }) => team.name).sort(), ["Blue", "Red"]);
  assert.equal("hostToken" in publicDetails, false);

  const unauthorized = await fetch(`${baseUrl}/rooms/${room.payload.id}/analytics`);
  assert.equal(unauthorized.status, 403);
  const analytics = await fetch(`${baseUrl}/rooms/${room.payload.id}/analytics?view=host`, { headers: { "x-host-token": room.payload.hostToken } });
  assert.equal(analytics.status, 200);
});

test("keeps a failed room switch atomic and allows only valid contest members to reconnect", async (context) => {
  const { baseUrl, connect, server } = await startFixture(context);
  const room = await createRoom(baseUrl);
  const hostSocket = connect();
  await new Promise<void>((resolve, reject) => {
    hostSocket.once("open", resolve);
    hostSocket.once("error", reject);
  });
  const hostJoin = waitForEvent(hostSocket, "player.reconnected");
  const hostSnapshot = waitForEvent(hostSocket, "room.snapshot");
  hostSocket.send(JSON.stringify({
    type: "room.join",
    roomCode: room.payload.code,
    displayName: "Host",
    collegeId: "test-college",
    hostToken: room.payload.hostToken,
  }));
  const hostIdentity = await hostJoin;
  await hostSnapshot;

  const failedSwitch = waitForEvent(hostSocket, "error");
  hostSocket.send(JSON.stringify({ type: "room.join", roomCode: "BAD000", displayName: "Host", collegeId: "test-college" }));
  assert.match((await failedSwitch).payload.message, /Room not found/);

  const questionStarted = waitForEvent(hostSocket, "question.started");
  hostSocket.send(JSON.stringify({ type: "game.start", roomId: room.payload.id }));
  await questionStarted;

  const lateSocket = connect();
  await new Promise<void>((resolve, reject) => {
    lateSocket.once("open", resolve);
    lateSocket.once("error", reject);
  });
  const denied = waitForEvent(lateSocket, "error");
  lateSocket.send(JSON.stringify({
    type: "room.join",
    roomCode: room.payload.code,
    displayName: "Late player",
    collegeId: "test-college",
    sessionToken: "fabricated-session-token",
  }));
  assert.match((await denied).payload.message, /Invalid session token|already started/);
  assert.equal(server.engine.snapshot(room.payload.id).room.players.length, 1);

  const replacement = connect();
  await new Promise<void>((resolve, reject) => {
    replacement.once("open", resolve);
    replacement.once("error", reject);
  });
  const replacementIdentity = waitForEvent(replacement, "player.reconnected");
  const replacedClose = new Promise<number>((resolve) => hostSocket.once("close", (code) => resolve(code)));
  replacement.send(JSON.stringify({
    type: "room.join",
    roomCode: room.payload.code,
    displayName: "Host",
    collegeId: "test-college",
    sessionToken: hostIdentity.payload.sessionToken,
    hostToken: room.payload.hostToken,
  }));
  const reconnected = await replacementIdentity;
  assert.equal(reconnected.payload.playerId, hostIdentity.payload.playerId);
  assert.equal(await replacedClose, 4001);
  assert.equal(server.engine.snapshot(room.payload.id).room.players[0].connected, true);
  await delay(20);
});

