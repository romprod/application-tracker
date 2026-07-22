const authenticationRequiredEvent =
  "application-tracker:authentication-required";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function requiresAuthentication(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body: unknown = await response.clone().json();
    return (
      isRecord(body) &&
      isRecord(body.error) &&
      body.error.code === "authentication_required"
    );
  } catch {
    return false;
  }
}

export async function browserApiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (await requiresAuthentication(response)) {
    window.dispatchEvent(new Event(authenticationRequiredEvent));
  }
  return response;
}

export function observeAuthenticationRequired(
  listener: () => void,
): () => void {
  window.addEventListener(authenticationRequiredEvent, listener);
  return () =>
    window.removeEventListener(authenticationRequiredEvent, listener);
}
