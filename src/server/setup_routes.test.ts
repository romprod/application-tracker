import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { SetupService } from "../application/setup.js";
import { ScryptPasswordHasher } from "../infrastructure/auth/password_hasher.js";
import { StaticSetupTokenVerifier } from "../infrastructure/auth/setup_token_verifier.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";
import { createApp } from "./app.js";

const databases: ReturnType<typeof openApplicationDatabase>[] = [];
const setupToken = "a".repeat(64);

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

function createSetupApp(token: string | null = setupToken) {
  const database = openApplicationDatabase(":memory:");
  databases.push(database);
  const setupService = new SetupService(
    new SqliteSetupRepository(database),
    new ScryptPasswordHasher({ cost: 1024, maxMemory: 8_388_608 }),
    new StaticSetupTokenVerifier(token ?? undefined),
  );

  return { app: createApp({ setupService }), database };
}

describe("setup routes", () => {
  it("reports whether closed setup can be completed", async () => {
    const configured = createSetupApp();
    const missingToken = createSetupApp(null);

    const status = await request(configured.app)
      .get("/api/setup/status")
      .expect(200, {
        required: true,
        tokenConfigured: true,
      });
    expect(status.headers["cache-control"]).toBe("no-store");
    await request(missingToken.app).get("/api/setup/status").expect(200, {
      required: true,
      tokenConfigured: false,
    });
  });

  it("validates input without creating a user", async () => {
    const { app, database } = createSetupApp();

    const response = await request(app).post("/api/setup").send({
      displayName: "Alex Example",
      password: "short",
      setupToken,
      username: "alex",
      workspaceName: "Applications",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: "validation_error" } });
    expect(database.prepare("SELECT count(*) FROM users").pluck().get()).toBe(
      0,
    );
  });

  it("rejects an incorrect setup token", async () => {
    const { app } = createSetupApp();

    const response = await request(app)
      .post("/api/setup")
      .send({
        displayName: "Alex Example",
        password: "correct horse battery staple",
        setupToken: "b".repeat(64),
        username: "alex",
        workspaceName: "Applications",
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { code: "invalid_setup_token" } });
  });

  it("creates one administrator and permanently closes setup", async () => {
    const { app } = createSetupApp();
    const input = {
      displayName: "Alex Example",
      password: "correct horse battery staple",
      setupToken,
      username: "alex",
      workspaceName: "Applications",
    };

    const created = await request(app)
      .post("/api/setup")
      .send(input)
      .expect(201);
    expect(created.body).toMatchObject({
      administrator: { displayName: "Alex Example", username: "alex" },
      workspace: { name: "Applications" },
    });

    await request(app).get("/api/setup/status").expect(200, {
      required: false,
      tokenConfigured: true,
    });
    const repeated = await request(app).post("/api/setup").send(input);
    expect(repeated.status).toBe(409);
    expect(repeated.body).toEqual({ error: { code: "setup_complete" } });
  });
});
