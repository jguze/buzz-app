// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PairingPrompt } from "./PairingPrompt";
import { isSavedCommunity, type PairRequest } from "./service";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const handlers = new Map<string, (event: { payload: unknown }) => void>();
beforeEach(() => {
  handlers.clear();
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  vi.mocked(listen).mockImplementation(async (name, handler) => {
    handlers.set(name, handler as (event: { payload: unknown }) => void);
    return () => handlers.delete(name);
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const request: PairRequest = {
  id: "r1",
  client: "buzz-cli",
  relay: "wss://relay.example/",
  process: "/usr/local/bin/buzz",
  expiresIn: 120,
};
const ask = async (payload: PairRequest) => {
  await vi.waitFor(() =>
    expect(handlers.has("credential-pair-request")).toBe(true),
  );
  act(() => handlers.get("credential-pair-request")?.({ payload }));
};

it("names the tool, community and process, with Deny focused", async () => {
  render(<PairingPrompt communities={["wss://relay.example"]} />);
  await ask(request);
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent(
    "buzz-cli wants to use Buzz as you on wss://relay.example/",
  );
  expect(dialog).toHaveTextContent("Requested by /usr/local/bin/buzz");
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Deny" })).toHaveFocus(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Allow" }));
  expect(invoke).toHaveBeenCalledWith("credential_pair_answer", {
    id: "r1",
    answer: "allow",
  });
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("refuses a community not saved here without asking, saying why", async () => {
  render(<PairingPrompt communities={["wss://relay.example"]} />);
  await ask({ ...request, relay: "wss://other.example/" });
  expect(invoke).toHaveBeenCalledWith("credential_pair_answer", {
    id: "r1",
    answer: "unsaved",
  });
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("declines on Deny, and when the page goes away mid-request", async () => {
  const { unmount } = render(
    <PairingPrompt communities={["wss://relay.example"]} />,
  );
  await ask(request);
  await userEvent.click(await screen.findByRole("button", { name: "Deny" }));
  expect(invoke).toHaveBeenCalledWith("credential_pair_answer", {
    id: "r1",
    answer: "deny",
  });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await ask({ ...request, id: "r2" });
  await screen.findByRole("alertdialog");
  unmount();
  expect(invoke).toHaveBeenCalledWith("credential_pair_answer", {
    id: "r2",
    answer: "deny",
  });
});

it("closes when native ends the request, and when its time runs out", async () => {
  render(<PairingPrompt communities={["wss://relay.example"]} />);
  await ask(request);
  await screen.findByRole("alertdialog");
  act(() => handlers.get("credential-pair-closed")?.({ payload: "r1" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  vi.useFakeTimers();
  act(() =>
    handlers.get("credential-pair-request")?.({
      payload: { ...request, id: "r2", expiresIn: 2 },
    }),
  );
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Expires in 2 s");
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("matches a saved community by its whole normalized URL", () => {
  const saved = ["wss://relay.example"];
  expect(isSavedCommunity("wss://relay.example/", saved)).toBe(true);
  expect(isSavedCommunity("wss://relay.example", saved)).toBe(true);
  expect(isSavedCommunity("WSS://Relay.Example:443/", saved)).toBe(true);
  // Path and query are part of the community a tool binds.
  expect(isSavedCommunity("wss://relay.example/team/", saved)).toBe(false);
  expect(isSavedCommunity("wss://relay.example/?team=a", saved)).toBe(false);
  expect(isSavedCommunity("ws://relay.example/", saved)).toBe(false);
  expect(isSavedCommunity("wss://user@relay.example/", saved)).toBe(false);
  expect(isSavedCommunity("wss://relay.example.evil/", saved)).toBe(false);
  expect(isSavedCommunity("not a url", saved)).toBe(false);
});
