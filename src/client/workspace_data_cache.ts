import type {
  ApplicationRecord,
  ApplicationsClient,
} from "./applications_client";
import type {
  ReferenceValue,
  ReferenceValuesClient,
} from "./reference_values_client";

interface QueryEntry<T> {
  loadedAt?: number;
  promise?: Promise<T>;
  value?: T;
}

const queryFreshnessMilliseconds = 30_000;
let applicationQueries = new WeakMap<
  ApplicationsClient,
  QueryEntry<ApplicationRecord[]>
>();
let referenceValueQueries = new WeakMap<
  ReferenceValuesClient,
  QueryEntry<ReferenceValue[]>
>();

function loadQuery<T>(
  entry: QueryEntry<T>,
  loader: () => Promise<T>,
): Promise<T> {
  if (
    entry.value !== undefined &&
    entry.loadedAt !== undefined &&
    Date.now() - entry.loadedAt < queryFreshnessMilliseconds
  ) {
    return Promise.resolve(entry.value);
  }
  if (entry.promise) return entry.promise;

  entry.promise = loader()
    .then((value) => {
      entry.value = value;
      entry.loadedAt = Date.now();
      delete entry.promise;
      return value;
    })
    .catch((error: unknown) => {
      delete entry.promise;
      throw error;
    });
  return entry.promise;
}

function queryEntry<Client extends object, T>(
  queries: WeakMap<Client, QueryEntry<T>>,
  client: Client,
): QueryEntry<T> {
  const existing = queries.get(client);
  if (existing) return existing;
  const created: QueryEntry<T> = {};
  queries.set(client, created);
  return created;
}

function updateQuery<T>(entry: QueryEntry<T>, update: (current: T) => T): void {
  if (entry.value !== undefined) entry.value = update(entry.value);
  entry.loadedAt = Date.now();
  if (entry.promise) {
    entry.promise = entry.promise.then((value) => {
      const updated = update(value);
      entry.value = updated;
      return updated;
    });
  }
}

export function loadCachedApplications(
  client: ApplicationsClient,
): Promise<ApplicationRecord[]> {
  return loadQuery(queryEntry(applicationQueries, client), () =>
    client.listApplications(),
  );
}

export function updateCachedApplications(
  client: ApplicationsClient,
  update: (current: ApplicationRecord[]) => ApplicationRecord[],
): void {
  updateQuery(queryEntry(applicationQueries, client), update);
}

export function loadCachedReferenceValues(
  client: ReferenceValuesClient,
): Promise<ReferenceValue[]> {
  return loadQuery(queryEntry(referenceValueQueries, client), () =>
    client.listValues(),
  );
}

export function updateCachedReferenceValues(
  client: ReferenceValuesClient,
  update: (current: ReferenceValue[]) => ReferenceValue[],
): void {
  updateQuery(queryEntry(referenceValueQueries, client), update);
}

export function clearWorkspaceDataCache(): void {
  applicationQueries = new WeakMap();
  referenceValueQueries = new WeakMap();
}
