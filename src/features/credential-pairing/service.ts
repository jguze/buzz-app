// Command-line tools paired with this app through the local credential
// provider. Native code owns pairing; the page approves requests and lists
// and revokes pairings.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { communityDestination } from "../communities/destination";

export type PairRequest = {
  id: string;
  client: string;
  relay: string;
  process: string | null;
  expiresIn: number;
};

export type PairedTool = {
  id: string;
  client: string;
  relay: string;
  /** Unix seconds. */
  created: number;
  lastUsed: number;
  expires: number;
};

/** `unsaved` refuses a request for a community not saved here, telling the
 * tool why, without asking the person. */
export type PairAnswer = "allow" | "deny" | "unsaved";

export const answerPairing = (id: string, answer: PairAnswer) =>
  invoke<void>("credential_pair_answer", { id, answer });

/** Tells native a prompt began or stopped listening; while none listens,
 * native refuses pairing at once instead of asking nobody. */
export const setPairingPrompt = (mounted: boolean) =>
  invoke<void>("credential_pair_prompt", { mounted });

export const listPairedTools = () =>
  invoke<PairedTool[]>("credential_pairings_list");

export const revokePairedTool = (id: string) =>
  invoke<void>("credential_pairing_revoke", { id });

/** Calls `on` for each change, and `ready` once every listener is in place;
 * returns a function that stops listening. */
export function onPairingEvents(on: {
  request?(request: PairRequest): void;
  closed?(id: string): void;
  changed?(): void;
  ready?(): void;
}) {
  const stops = [
    on.request &&
      listen<PairRequest>("credential-pair-request", (event) =>
        on.request?.(event.payload),
      ),
    on.closed &&
      listen<string>("credential-pair-closed", (event) =>
        on.closed?.(event.payload),
      ),
    on.changed && listen("credential-pairings-changed", () => on.changed?.()),
  ];
  // Without the native event channel there is nothing to approve or list.
  const listening = stops.map((stop) => stop?.catch(() => undefined));
  void Promise.all(stops).then(
    () => on.ready?.(),
    () => undefined,
  );
  return () => {
    for (const stop of listening) void stop?.then((unlisten) => unlisten?.());
  };
}

/** A relay URL compared whole, as native code binds it: lowercase host, no
 * default port, `/` for an empty path, path and query kept; `wss` read as
 * `https` and `ws` as `http`. `null` for anything else. */
function comparable(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const scheme = {
    "wss:": "https:",
    "https:": "https:",
    "ws:": "http:",
    "http:": "http:",
  }[url.protocol];
  if (!scheme || url.username || url.password || url.hash) return null;
  if (url.hostname.endsWith(".")) url.hostname = url.hostname.slice(0, -1);
  return `${scheme}//${url.host}${url.pathname}${url.search}`;
}

/** Whether `relay` is one of these saved communities, compared as whole
 * URLs, so `wss://host/team/` is not the community `wss://host`. A tool may
 * only pair for a community the person already uses here. */
export function isSavedCommunity(
  relay: string,
  communities: readonly string[],
) {
  const requested = comparable(relay);
  if (requested === null) return false;
  return communities.some((id) => {
    try {
      return comparable(communityDestination(id).url) === requested;
    } catch {
      return false;
    }
  });
}
