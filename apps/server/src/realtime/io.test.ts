import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import Redis from "ioredis";
import { io as ioc, type Socket } from "socket.io-client";
import {
  redisChannels,
  type BlogPostPipelineInput,
  type RunEvent,
} from "@conductor/shared";
import { buildApp } from "../app";
import { auth } from "../auth/auth";
import { env } from "../env";
import { repos } from "../repos/index";
import { signUpOwner, type TestOrgOwner } from "../test-utils/auth";

/**
 * Socket.IO realtime relay tests (Unit 17) — real Better Auth + Postgres +
 * Redis. Proves handshake auth, org-scoped room subscription, and per-org event
 * isolation. Requires local Postgres (migrations applied) and Redis.
 */
const checks = {
  postgres: async () => true,
  redis: async () => true,
  temporal: async () => true,
};

const sampleInput: BlogPostPipelineInput = {
  topic: "Durable AI pipelines",
  keywords: ["temporal", "reliability"],
  tone: "technical",
  wordCount: 1200,
  approverId: "user_approver",
};

let app: FastifyInstance;
let port: number;
let pub: Redis;
let ownerA: TestOrgOwner;
let ownerB: TestOrgOwner;
let runA: { id: string };
let runB: { id: string };
const clients: Socket[] = [];

async function createRun(orgId: string): Promise<{ id: string }> {
  return repos.runs.createRun({
    orgId,
    workflowName: "contentPipeline",
    temporalWorkflowId: `content-${randomUUID()}`,
    input: sampleInput,
    status: "running",
  });
}

function connect(token: string): Socket {
  const socket = ioc(`http://127.0.0.1:${port}`, {
    path: "/ws",
    transports: ["websocket"],
    auth: { token },
    reconnection: false,
  });
  clients.push(socket);
  return socket;
}

function once<T>(socket: Socket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function subscribe(socket: Socket, runId: string): Promise<{ ok: boolean; code?: string }> {
  return new Promise((resolve) => socket.emit("subscribe", runId, resolve));
}

beforeAll(async () => {
  app = await buildApp({ checks, auth, realtime: true });
  await app.listen({ host: "127.0.0.1", port: 0 });
  port = (app.server.address() as AddressInfo).port;
  pub = new Redis(env.REDIS_URL);
  ownerA = await signUpOwner(app);
  ownerB = await signUpOwner(app);
  runA = await createRun(ownerA.orgId);
  runB = await createRun(ownerB.orgId);
}, 30_000);

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await pub.quit().catch(() => undefined);
  await app.close();
});

describe("/ws handshake auth", () => {
  it("rejects a connection with no token", async () => {
    const socket = ioc(`http://127.0.0.1:${port}`, {
      path: "/ws",
      transports: ["websocket"],
      auth: {},
      reconnection: false,
    });
    clients.push(socket);
    const err = await once<Error>(socket, "connect_error");
    expect(err.message).toBe("unauthorized");
  });

  it("accepts a connection with a valid JWT", async () => {
    const socket = connect(ownerA.jwt);
    await once(socket, "connect");
    expect(socket.connected).toBe(true);
  });
});

describe("room subscription is org-scoped", () => {
  it("joins a run in the caller's org and refuses another org's run", async () => {
    const socket = connect(ownerA.jwt);
    await once(socket, "connect");

    expect(await subscribe(socket, runA.id)).toEqual({ ok: true });
    expect(await subscribe(socket, runB.id)).toEqual({ ok: false, code: "not_found" });
    expect(await subscribe(socket, randomUUID())).toEqual({ ok: false, code: "not_found" });
  });
});

describe("event isolation", () => {
  it("delivers an event only to subscribers of that run", async () => {
    const a = connect(ownerA.jwt);
    const b = connect(ownerB.jwt);
    await Promise.all([once(a, "connect"), once(b, "connect")]);
    await Promise.all([subscribe(a, runA.id), subscribe(b, runB.id)]);

    let bReceived = false;
    b.on("run.event", () => {
      bReceived = true;
    });

    const event: RunEvent = {
      type: "run.status",
      runId: runA.id,
      status: "completed",
      at: new Date().toISOString(),
    };
    const received = once<RunEvent>(a, "run.event");
    // Give psubscribe a beat, then publish on run A's channel only.
    await new Promise((r) => setTimeout(r, 150));
    await pub.publish(redisChannels.status(runA.id), JSON.stringify(event));

    expect(await received).toEqual(event);
    expect(bReceived).toBe(false);
  }, 15_000);
});
