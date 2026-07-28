import { lookup as dnsLookup } from "node:dns/promises";
import {
  request as httpsRequest,
  type RequestOptions as HttpsRequestOptions,
} from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

export const maximumPublicHttpsResponseBytes = 1_048_576;
export const publicHttpsRequestTimeoutMs = 5_000;

export interface ResolvedPublicAddress {
  address: string;
  family: 4 | 6;
}

export interface PublicHttpsResponse {
  body: string;
  contentType: string | null;
  location: string | null;
  status: number;
}

export interface PublicHttpsReadOptions {
  includeBody: boolean;
  maxBytes: number;
  timeoutMs: number;
}

export interface PublicHttpsReader {
  read(url: URL, options: PublicHttpsReadOptions): Promise<PublicHttpsResponse>;
}

export type PublicAddressLookup = (
  hostname: string,
) => Promise<ResolvedPublicAddress[]>;

export type PinnedHttpsTransport = (
  url: URL,
  address: ResolvedPublicAddress,
  options: PublicHttpsReadOptions,
) => Promise<PublicHttpsResponse>;

export class PublicHttpsPolicyError extends Error {
  public constructor(
    public readonly code:
      | "invalid_url"
      | "network_capacity"
      | "non_public_address"
      | "response_too_large"
      | "timeout",
  ) {
    super(`Public HTTPS request rejected: ${code}`);
    this.name = "PublicHttpsPolicyError";
  }
}

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}

const blockedIpv6 = new BlockList();
blockedIpv6.addSubnet("2001:db8::", 32, "ipv6");

function normalizedHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedIpv4.check(address, "ipv4");
  if (family !== 6) return false;

  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return false;
  const firstGroup = Number.parseInt(normalized.split(":", 1)[0] ?? "", 16);
  return (
    Number.isInteger(firstGroup) &&
    firstGroup >= 0x2000 &&
    firstGroup <= 0x3fff &&
    !blockedIpv6.check(address, "ipv6")
  );
}

export function validatePublicHttpsUrl(url: URL): void {
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443") ||
    url.href.length > 2048
  ) {
    throw new PublicHttpsPolicyError("invalid_url");
  }
}

async function defaultPublicAddressLookup(
  hostname: string,
): Promise<ResolvedPublicAddress[]> {
  const normalized = normalizedHostname(hostname);
  const literalFamily = isIP(normalized);
  if (literalFamily !== 0) {
    return [
      {
        address: normalized,
        family: literalFamily as 4 | 6,
      },
    ];
  }
  const addresses = await dnsLookup(normalized, {
    all: true,
    verbatim: true,
  });
  return addresses.flatMap(({ address, family }) =>
    family === 4 || family === 6 ? [{ address, family }] : [],
  );
}

class OutboundRequestGate {
  private active = 0;

  public constructor(private readonly maximumActive: number) {}

  public acquire(): () => void {
    if (this.active >= this.maximumActive) {
      throw new PublicHttpsPolicyError("network_capacity");
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}

const outboundRequestGate = new OutboundRequestGate(8);

function normalizedHeader(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

const defaultPinnedHttpsTransport: PinnedHttpsTransport = (
  url,
  address,
  options,
) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      operation();
    };
    const request = httpsRequest(
      url,
      pinnedHttpsRequestOptions(url, address),
      (response) => {
        const contentLength = Number.parseInt(
          normalizedHeader(response.headers["content-length"]) ?? "",
          10,
        );
        if (
          options.includeBody &&
          Number.isFinite(contentLength) &&
          contentLength > options.maxBytes
        ) {
          response.destroy();
          finish(() =>
            reject(new PublicHttpsPolicyError("response_too_large")),
          );
          return;
        }

        const result = {
          contentType: normalizedHeader(response.headers["content-type"]),
          location: normalizedHeader(response.headers.location),
          status: response.statusCode ?? 0,
        };
        if (
          !options.includeBody ||
          [301, 302, 303, 307, 308].includes(result.status)
        ) {
          response.destroy();
          finish(() => resolve({ ...result, body: "" }));
          return;
        }

        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBytes += bytes.byteLength;
          if (receivedBytes > options.maxBytes) {
            response.destroy();
            finish(() =>
              reject(new PublicHttpsPolicyError("response_too_large")),
            );
            return;
          }
          chunks.push(bytes);
        });
        response.on("end", () => {
          finish(() =>
            resolve({
              ...result,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        });
        response.on("error", (error) => finish(() => reject(error)));
      },
    );
    const totalTimer = setTimeout(() => {
      request.destroy(new PublicHttpsPolicyError("timeout"));
    }, options.timeoutMs);
    totalTimer.unref();
    request.on("error", (error) => finish(() => reject(error)));
    request.end();
  });

export function pinnedHttpsRequestOptions(
  url: URL,
  address: ResolvedPublicAddress,
): HttpsRequestOptions {
  const lookup: LookupFunction = (_hostname, _lookupOptions, callback) => {
    callback(null, address.address, address.family);
  };
  return {
    agent: false,
    family: address.family,
    headers: {
      Accept: "text/html, application/xhtml+xml;q=0.9",
      "Accept-Encoding": "identity",
      "User-Agent": "ApplicationTrackerJobPostingInspector/1.0",
    },
    lookup,
    method: "GET",
    ...(isIP(normalizedHostname(url.hostname)) === 0
      ? { servername: normalizedHostname(url.hostname) }
      : {}),
  };
}

function deadlinePromise<Result>(
  operation: Promise<Result>,
  timeoutMs: number,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PublicHttpsPolicyError("timeout")),
      timeoutMs,
    );
    timer.unref();
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(
          error instanceof Error
            ? error
            : new Error("Public HTTPS operation failed"),
        );
      },
    );
  });
}

export class SecurePublicHttpsReader implements PublicHttpsReader {
  public constructor(
    private readonly lookup: PublicAddressLookup = defaultPublicAddressLookup,
    private readonly transport: PinnedHttpsTransport = defaultPinnedHttpsTransport,
  ) {}

  public async read(
    url: URL,
    options: PublicHttpsReadOptions,
  ): Promise<PublicHttpsResponse> {
    validatePublicHttpsUrl(url);
    if (
      !Number.isInteger(options.maxBytes) ||
      options.maxBytes < 0 ||
      options.maxBytes > maximumPublicHttpsResponseBytes ||
      !Number.isInteger(options.timeoutMs) ||
      options.timeoutMs < 1 ||
      options.timeoutMs > publicHttpsRequestTimeoutMs
    ) {
      throw new PublicHttpsPolicyError("invalid_url");
    }

    const release = outboundRequestGate.acquire();
    const deadline = Date.now() + options.timeoutMs;
    try {
      const addresses = await deadlinePromise(
        this.lookup(normalizedHostname(url.hostname)),
        options.timeoutMs,
      );
      if (
        addresses.length === 0 ||
        addresses.some(
          ({ address, family }) =>
            (family !== 4 && family !== 6) ||
            isIP(address) !== family ||
            !isPublicIpAddress(address),
        )
      ) {
        throw new PublicHttpsPolicyError("non_public_address");
      }
      const remainingMs = Math.max(1, deadline - Date.now());
      return await deadlinePromise(
        this.transport(url, addresses[0]!, {
          ...options,
          timeoutMs: remainingMs,
        }),
        remainingMs,
      );
    } finally {
      release();
    }
  }
}
