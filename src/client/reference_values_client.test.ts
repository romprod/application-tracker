import { describe, expect, it, vi } from "vitest";

import {
  browserReferenceValuesClient,
  ReferenceValuesClientError,
} from "./reference_values_client";

const value = {
  category: "status" as const,
  createdAt: "2026-07-18T12:00:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
  isActive: true,
  isTerminal: false,
  label: "Prospect",
  sortOrder: 10,
  updatedAt: "2026-07-18T12:00:00.000Z",
};

describe("browserReferenceValuesClient", () => {
  it("lists and validates reference values", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ values: [value] }), { status: 200 }),
        ),
    );

    await expect(browserReferenceValuesClient.listValues()).resolves.toEqual([
      value,
    ]);
    expect(fetch).toHaveBeenCalledWith("/api/settings/lists", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  });

  it("sends mutations with JSON and reports stable errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "reference_value_conflict" } }),
          { status: 409 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserReferenceValuesClient.createValue({
        category: "status",
        isTerminal: false,
        label: "Prospect",
      }),
    ).resolves.toEqual(value);
    await expect(
      browserReferenceValuesClient.updateValue(value.id, { label: "Applied" }),
    ).rejects.toMatchObject({
      code: "reference_value_conflict",
    });
  });

  it("deletes values without parsing an empty response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    await expect(
      browserReferenceValuesClient.deleteValue(value.id),
    ).resolves.toBeUndefined();
  });

  it("rejects malformed list values", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ values: [{ ...value, id: "not-an-id" }] }),
            { status: 200 },
          ),
        ),
    );

    await expect(browserReferenceValuesClient.listValues()).rejects.toEqual(
      new ReferenceValuesClientError("invalid_response"),
    );
  });
});
