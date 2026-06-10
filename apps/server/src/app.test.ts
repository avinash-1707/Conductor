import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { NotFoundError } from "./errors";
import type { ReadinessChecks } from "./deps";

const allPass: ReadinessChecks = {
  postgres: async () => true,
  redis: async () => true,
  temporal: async () => true,
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("health and readiness", () => {
  it("GET /health returns 200 ok", async () => {
    app = await buildApp({ checks: allPass });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /ready returns 200 ready when all checks pass", async () => {
    app = await buildApp({ checks: allPass });
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ready",
      checks: { postgres: true, redis: true, temporal: true },
    });
  });

  it("GET /ready returns 503 not_ready when a dependency is down", async () => {
    app = await buildApp({
      checks: { ...allPass, postgres: async () => false },
    });
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: "not_ready",
      checks: { postgres: false, redis: true, temporal: true },
    });
  });
});

describe("error handling", () => {
  it("unknown routes return a typed 404", async () => {
    app = await buildApp({ checks: allPass });
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "not_found", message: "Route GET /nope not found" },
    });
  });

  it("maps a thrown AppError to its status and code", async () => {
    app = await buildApp({ checks: allPass });
    app.get("/__app_error", async () => {
      throw new NotFoundError("widget missing");
    });
    const res = await app.inject({ method: "GET", url: "/__app_error" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "not_found", message: "widget missing" },
    });
  });

  it("maps an unexpected error to a generic 500 without leaking internals", async () => {
    app = await buildApp({ checks: allPass });
    app.get("/__boom", async () => {
      throw new Error("secret stack detail");
    });
    const res = await app.inject({ method: "GET", url: "/__boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: "internal", message: "Internal Server Error" },
    });
  });
});
