import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";

describe("health endpoint", () => {
  it("reports service availability without configuration details", async () => {
    const response = await request(createApp()).get("/api/health").expect(200);

    expect(response.body).toEqual({
      service: "application-tracker",
      status: "ok",
    });
  });
});
