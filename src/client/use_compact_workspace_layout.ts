import { useSyncExternalStore } from "react";

export const compactWorkspaceQuery =
  "(max-width: 680px), (max-width: 940px) and (max-height: 520px)";

function compactQueryList(): MediaQueryList | undefined {
  if (typeof window === "undefined" || !window.matchMedia) return undefined;
  return window.matchMedia(compactWorkspaceQuery);
}

function subscribe(listener: () => void): () => void {
  const query = compactQueryList();
  if (!query) return () => undefined;
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function snapshot(): boolean {
  return compactQueryList()?.matches ?? false;
}

export function useCompactWorkspaceLayout(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
