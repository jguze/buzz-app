// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { apply } from "./index";
import { dayLabel, type ReadEvent } from "./model";

const viewer = "a".repeat(64);
const root = "b".repeat(64);
const id = "c".repeat(64);
const friend = "e".repeat(64);
const scout = "5".repeat(64);
const relay = "7".repeat(64);
const origin = "https://demo.invalid";
const scope = `${origin}:${viewer}`;
const saved = (key: string, value: unknown, partition = scope) =>
  localStorage.setItem(
    `buzz-view.v1:${JSON.stringify([partition, key])}`,
    JSON.stringify(value),
  );
const NOW = Date.UTC(2026, 10, 4, 18, 0, 0);
const team = ["h", "team"];
const inThread = [team, ["e", root, "", "reply"]];
const event = (overrides: Partial<ReadEvent> = {}) =>
  ({
    id,
    pubkey: viewer,
    kind: 9,
    created_at: NOW / 1000 - 600,
    content: "Recently shipped",
    tags: [team],
    ...overrides,
  }) as ReadEvent;
const pill = (row: HTMLElement) => row.querySelector("[data-tone]");
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type Filter = Record<string, unknown>;
type FakeView = {
  filters: Filter[];
  snapshot: () => { status: string; events: ReadEvent[] };
  subscribe: (listener: () => void) => () => void;
  refresh: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

function harness() {
  const list = {
    status: "ready",
    channels: [
      { id: "team", name: "launch-room", channelType: "stream" },
      {
        id: "solo",
        name: "Research helper",
        channelType: "solo",
        members: [viewer, scout],
      },
      { id: "dm", name: "DM", channelType: "dm", participants: [friend] },
      { id: "room", name: "Huddle", channelType: "stream", huddle: true },
      { id: "old", name: "old-plans", channelType: "stream", archived: true },
    ],
  };
  const profiles = new Map<string, { name: string; isAgent?: true }>([
    [friend, { name: "Sam Okafor" }],
    [scout, { name: "Scout", isAgent: true }],
  ]);
  const relayListeners = new Set<() => void>();
  let events: ReadEvent[] = [event()];
  let status = "ready";
  const viewListeners = new Set<() => void>();
  const view = {
    snapshot: () => ({ status, events }),
    subscribe: (listener: () => void) => {
      viewListeners.add(listener);
      return () => viewListeners.delete(listener);
    },
    refresh: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  // Conversation context: one shared, filter-matched pool of other people's messages.
  let others: ReadEvent[] = [];
  // A view that is still loading (or failed) has no events yet, as a rebuilt host view does.
  let contextStatus = "ready";
  const contextListeners = new Set<() => void>();
  const contextViews: FakeView[] = [];
  const contextView = (filters: Filter[]) => {
    const matching = () =>
      others.filter((e) =>
        filters.some(
          (f) =>
            (!f.ids || (f.ids as string[]).includes(e.id)) &&
            (!f["#e"] ||
              e.tags.some(
                (t) =>
                  t[0] === "e" && (f["#e"] as string[]).includes(t[1] ?? ""),
              )) &&
            (!f["#h"] ||
              e.tags.some(
                (t) =>
                  t[0] === "h" && (f["#h"] as string[]).includes(t[1] ?? ""),
              )) &&
            (f.since === undefined || e.created_at >= (f.since as number)),
        ),
      );
    const made: FakeView = {
      filters,
      snapshot: () => ({
        status: contextStatus,
        events: contextStatus === "ready" ? matching() : [],
      }),
      subscribe: (listener: () => void) => {
        contextListeners.add(listener);
        return () => contextListeners.delete(listener);
      },
      refresh: vi.fn(async () => {}),
      dispose: vi.fn(),
    };
    contextViews.push(made);
    return made;
  };
  const session = {
    scope,
    relayAuthor: relay,
    channels: {
      list: () => list,
      subscribeList: () => () => {},
      ensureList: vi.fn(),
      refreshList: vi.fn(),
    },
    profiles: {
      snapshot: () => profiles,
      subscribe: () => () => {},
      ensure: vi.fn(async () => {}),
    },
    names: {
      snapshot: () => 0,
      subscribe: () => () => {},
      resolve: (_key: string, fallback: string) => fallback,
    },
    media: (url: string) => url,
    observe: vi.fn((filters: Filter[]) =>
      (filters[0]?.authors as string[] | undefined)?.includes(viewer)
        ? view
        : contextView(filters),
    ),
  };
  let connection = {
    status: "ready",
    generation: 1,
    scope,
    viewer,
    origin,
    session,
  };
  let page:
    | { component: ComponentType; badge: ComponentType; title: string }
    | undefined;
  const open = vi.fn(async () => ({ status: "opened" }));
  const ctx = {
    relay: {
      snapshot: () => connection,
      subscribe: (f: () => void) => {
        relayListeners.add(f);
        return () => relayListeners.delete(f);
      },
    },
    navigation: { open },
    pages: {
      register: (p: typeof page) => {
        page = p;
      },
    },
  } as unknown as Parameters<typeof apply>[0];
  void apply(ctx);
  if (!page) throw new Error("expected a registered page");
  return {
    page,
    open,
    view,
    session,
    contextViews,
    replies(next: ReadEvent[], nextStatus = "ready") {
      others = next;
      contextStatus = nextStatus;
      for (const f of contextListeners) f();
    },
    emit(next: ReadEvent[], nextStatus = "ready") {
      events = next;
      status = nextStatus;
      for (const f of viewListeners) f();
    },
    switchIdentity() {
      const other = "d".repeat(64);
      connection = {
        ...connection,
        generation: 2,
        viewer: other,
        scope: `${origin}:${other}`,
        session: { ...session, scope: `${origin}:${other}` },
      };
      for (const f of relayListeners) f();
    },
  };
}

it("registers a sidebar page with a live draft count", () => {
  saved(`draft:team:thread:${root}`, { text: "Finish launch reply" });
  saved("draft:room", "Huddle notes stay out");
  const h = harness();
  expect(h.page.title).toBe("Drafts & sent");
  const Badge = h.page.badge;
  render(<Badge />);
  expect(screen.getByLabelText("1 draft").textContent).toBe("1");
  saved("draft:dm", "Second");
  act(() => window.dispatchEvent(new Event("focus")));
  expect(screen.getByLabelText("2 drafts")).toBeInTheDocument();
});

it("leaves archived conversations' drafts out of the list and count, but keeps their sent messages", () => {
  saved("draft:old", "Stranded note");
  saved("draft:dm", "Lunch tomorrow?");
  const h = harness();
  h.emit([
    event({ content: "Shipped before archiving", tags: [["h", "old"]] }),
  ]);
  const Page = h.page.component;
  const Badge = h.page.badge;
  render(
    <>
      <Badge />
      <Page />
    </>,
  );
  expect(screen.getByLabelText("1 draft")).toBeInTheDocument();
  const drafts = screen.getByRole("list", { name: "Drafts" });
  expect(within(drafts).getByText("Lunch tomorrow?")).toBeInTheDocument();
  expect(screen.queryByText("Stranded note")).toBeNull();
  expect(screen.getByText("Shipped before archiving")).toBeInTheDocument();
  // Hidden, not cleared: unarchiving brings the draft back.
  expect(
    localStorage.getItem(
      `buzz-view.v1:${JSON.stringify([scope, "draft:old"])}`,
    ),
  ).not.toBeNull();
});

it("shows archived conversations' drafts on request, labeled and clearable, without counting them", async () => {
  const user = userEvent.setup();
  saved("draft:old", "Stranded note");
  saved("draft:dm", "Lunch tomorrow?");
  const h = harness();
  const Page = h.page.component;
  const Badge = h.page.badge;
  render(
    <>
      <Badge />
      <Page />
    </>,
  );
  const toggle = screen.getByRole("button", { name: "Show archived (1)" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await user.click(toggle);
  expect(screen.getByRole("button", { name: "Hide archived" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const list = screen.getByRole("list", { name: "Drafts" });
  expect(within(list).getByText("Archived")).toBeInTheDocument();
  expect(
    within(list).getByRole("button", {
      name: "Open conversation in #old-plans, archived: Stranded note",
    }),
  ).toBeInTheDocument();
  // Shown, still not counted.
  expect(screen.getByLabelText("1 draft")).toBeInTheDocument();
  await user.click(
    within(list).getByRole("button", {
      name: "Clear draft in #old-plans, archived: Stranded note",
    }),
  );
  expect(screen.queryByText("Stranded note")).toBeNull();
  expect(
    localStorage.getItem(
      `buzz-view.v1:${JSON.stringify([scope, "draft:old"])}`,
    ),
  ).toBeNull();
  // Nothing archived is left to show.
  expect(screen.queryByRole("button", { name: /archived/i })).toBeNull();
});

it("scopes the empty Drafts message when only archived drafts are saved", () => {
  saved("draft:old", "Stranded note");
  const Page = harness().page.component;
  render(<Page />);
  expect(
    screen.getByText("No drafts outside archived conversations."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Show archived (1)" }),
  ).toBeInTheDocument();
});

it("lists drafts first and continues a thread draft at its root", async () => {
  saved(`draft:team:thread:${root}`, { text: "Finish launch reply" });
  saved("draft:dm", "Lunch tomorrow?");
  const h = harness();
  const Page = h.page.component;
  render(<Page />);
  const list = screen.getByRole("list", { name: "Drafts" });
  expect(within(list).getByText("#launch-room")).toBeInTheDocument();
  expect(within(list).getByText("Thread")).toBeInTheDocument();
  expect(within(list).getByText("Sam Okafor")).toBeInTheDocument();
  expect(within(list).getAllByText("Draft")).toHaveLength(2);
  fireEvent.click(
    screen.getByRole("button", {
      name: /Continue draft in #launch-room, thread/,
    }),
  );
  await waitFor(() =>
    expect(h.open).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "conversation",
        scope: { viewer, communityOrigin: origin },
        channelId: "team",
        threadRootId: root,
        messageId: root,
      }),
    ),
  );
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "missing" },
  });
  expect(screen.getByText("No drafts match “missing”.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByText("Finish launch reply")).toBeInTheDocument();
});

it("clears only the chosen draft from the keyboard, without opening it", async () => {
  const user = userEvent.setup();
  saved("draft:team", "Channel note");
  saved(`draft:team:thread:${root}`, { text: "Thread reply" });
  saved("draft:dm", "Lunch tomorrow?");
  saved("draft:gone", "Orphaned note");
  const h = harness();
  const Page = h.page.component;
  const Badge = h.page.badge;
  const rendered = render(
    <>
      <Badge />
      <Page />
    </>,
  );
  const list = screen.getByRole("list", { name: "Drafts" });
  expect(screen.getByLabelText("4 drafts")).toBeInTheDocument();
  expect(screen.getByText("Recently shipped")).toBeInTheDocument();

  const thread = within(list).getByRole("button", {
    name: "Clear draft in #launch-room, thread: Thread reply",
  });
  act(() => thread.focus());
  await user.keyboard("{Enter}");
  expect(within(list).queryByText("Thread reply")).toBeNull();
  expect(
    localStorage.getItem(
      `buzz-view.v1:${JSON.stringify([scope, `draft:team:thread:${root}`])}`,
    ),
  ).toBeNull();
  expect(within(list).getByText("Channel note")).toBeInTheDocument();
  expect(screen.getByLabelText("3 drafts")).toBeInTheDocument();
  // Focus stays in the list, on the neighbouring draft's clear action.
  expect(
    within(list).getByRole("button", {
      name: "Clear draft in #launch-room: Channel note",
    }),
  ).toHaveFocus();

  // A draft whose conversation is gone can't be opened, but can be cleared.
  expect(
    within(list).getByRole("button", { name: /Continue draft in Unavailable/ }),
  ).toBeDisabled();
  await user.click(
    within(list).getByRole("button", {
      name: "Clear draft in Unavailable conversation: Orphaned note",
    }),
  );
  expect(within(list).queryByText("Orphaned note")).toBeNull();
  expect(screen.getByLabelText("2 drafts")).toBeInTheDocument();
  expect(h.open).not.toHaveBeenCalled();
  // Sent messages have nothing to clear.
  expect(screen.getByText("Recently shipped")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /^Clear draft/ })).toHaveLength(
    2,
  );

  // The row itself still continues its draft.
  await user.click(
    within(list).getByRole("button", {
      name: /Continue draft in #launch-room/,
    }),
  );
  await waitFor(() =>
    expect(h.open).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "team" }),
    ),
  );

  // Cleared drafts stay cleared after a reload.
  rendered.unmount();
  render(<h.page.component />);
  const reloaded = screen.getByRole("list", { name: "Drafts" });
  expect(within(reloaded).getAllByRole("listitem")).toHaveLength(2);
  expect(within(reloaded).getByText("Channel note")).toBeInTheDocument();
  expect(within(reloaded).getByText("Lunch tomorrow?")).toBeInTheDocument();
});

it("keeps a draft and says so when storage can't forget it", async () => {
  saved("draft:team", "Stubborn note");
  const h = harness();
  const Page = h.page.component;
  render(<Page />);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
  fireEvent.click(
    screen.getByRole("button", {
      name: "Clear draft in #launch-room: Stubborn note",
    }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "This draft could not be cleared. Try again.",
  );
  expect(screen.getByText("Stubborn note")).toBeInTheDocument();
});

it("sent groups by day, updates live, and opens the exact message", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const h = harness();
  const Page = h.page.component;
  render(<Page />);
  expect(h.view.refresh).toHaveBeenCalled();
  expect(await screen.findByText("Recently shipped")).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: dayLabel(NOW / 1000 - 600, NOW) }),
  ).toBeInTheDocument();
  act(() =>
    h.emit([
      event({
        id: "9".repeat(64),
        content: "Just sent",
        created_at: NOW / 1000 + 5,
        tags: [["h", "dm"]],
      }),
      event(),
    ]),
  );
  expect(screen.getByText("Just sent")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", {
      name: /View message in #launch-room: Recently shipped/,
    }),
  );
  await waitFor(() =>
    expect(h.open).toHaveBeenLastCalledWith(
      expect.objectContaining({ channelId: "team", messageId: id }),
    ),
  );
  act(() => h.emit([], "error"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Sent messages could not be loaded.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(h.view.refresh).toHaveBeenCalledTimes(2);
});

it("clears identity-scoped content and releases the views on unmount", async () => {
  saved("draft:team", "Draft one");
  const h = harness();
  const Page = h.page.component;
  const rendered = render(<Page />);
  expect(screen.getByText("Draft one")).toBeInTheDocument();
  act(() => h.switchIdentity());
  await waitFor(() => expect(screen.queryByText("Draft one")).toBeNull());
  rendered.unmount();
  expect(h.view.dispose).toHaveBeenCalled();
  expect(h.contextViews.length).toBeGreaterThan(0);
  expect(
    h.contextViews.every((made) => made.dispose.mock.calls.length > 0),
  ).toBe(true);
});

it("shows participants with new-reply and you're-last status", () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const h = harness();
  const Page = h.page.component;
  const t = NOW / 1000;
  h.emit([
    event({
      id: "1".repeat(64),
      content: "Thread reply",
      created_at: t - 300,
      tags: inThread,
    }),
    event({
      id: "2".repeat(64),
      content: "Hi helper",
      created_at: t - 200,
      tags: [["h", "solo"]],
    }),
  ]);
  h.replies([
    event({
      id: root,
      pubkey: friend,
      created_at: t - 900,
      content: "Root",
      tags: [team],
    }),
    event({
      id: "3".repeat(64),
      pubkey: scout,
      created_at: t - 100,
      content: "Reply 1",
      tags: inThread,
    }),
    event({
      id: "4".repeat(64),
      pubkey: friend,
      created_at: t - 50,
      content: "Reply 2",
      tags: inThread,
    }),
  ]);
  render(<Page />);
  expect(
    screen.getByText("No drafts. Messages you start and don’t send wait here."),
  ).toBeInTheDocument();
  const thread = screen.getByRole("button", {
    name: /View message in #launch-room, thread: Thread reply/,
  });
  expect(within(thread).getByText("2 after you")).toBeInTheDocument();
  expect(thread.getAttribute("aria-label")).toMatch(
    /2 replies after yours, latest from Sam Okafor/,
  );
  expect(thread.getAttribute("aria-label")).toMatch(/With Sam Okafor, Scout/);
  expect(
    thread.querySelectorAll("[data-avatar-stack] > [data-avatar-shape]"),
  ).toHaveLength(2);
  expect(
    thread.querySelector(
      '[data-avatar-stack] > [data-avatar-shape="squircle"]',
    ),
  ).toBeTruthy();
  const solo = screen.getByRole("button", {
    name: /View message in Research helper: Hi helper/,
  });
  expect(within(solo).getByText("You’re last")).toBeInTheDocument();
  expect(screen.getByText("1 with replies after yours")).toBeInTheDocument();
  // A new reply arrives live.
  act(() =>
    h.replies([
      event({
        id: "6".repeat(64),
        pubkey: scout,
        created_at: t - 10,
        content: "Hey",
        tags: [["h", "solo"]],
      }),
    ]),
  );
  expect(
    within(
      screen.getByRole("button", { name: /Research helper: Hi helper/ }),
    ).getByText("1 after you"),
  ).toBeInTheDocument();
});

it("keeps each conversation's status tied to a complete read of it while views reload", () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const h = harness();
  const Page = h.page.component;
  const t = NOW / 1000;
  const other = "d".repeat(64);
  const mine = event({
    id: "1".repeat(64),
    content: "Thread reply",
    created_at: t - 300,
    tags: inThread,
  });
  const replies = [
    event({
      id: root,
      pubkey: friend,
      created_at: t - 900,
      content: "Root",
      tags: [team],
    }),
    event({
      id: "3".repeat(64),
      pubkey: scout,
      created_at: t - 100,
      content: "Reply 1",
      tags: inThread,
    }),
  ];
  h.emit([mine]);
  h.replies(replies);
  render(<Page />);
  const first = () =>
    screen.getByRole("button", {
      name: /View message in #launch-room, thread: Thread reply/,
    });
  expect(within(first()).getByText("1 after you")).toBeInTheDocument();
  // You reply in another thread: the context views are rebuilt and start out loading.
  h.replies(replies, "loading");
  act(() =>
    h.emit([
      event({
        id: "2".repeat(64),
        content: "Other thread",
        created_at: t - 20,
        tags: [team, ["e", other, "", "reply"]],
      }),
      mine,
    ]),
  );
  expect(
    h.contextViews.some(
      (made) =>
        JSON.stringify(made.filters[0]?.["#e"]) ===
        JSON.stringify([root, other].sort()),
    ),
  ).toBe(true);
  // The loaded thread keeps its evidence; the new one shows no status rather than "You're last".
  expect(within(first()).getByText("1 after you")).toBeInTheDocument();
  const second = () =>
    screen.getByRole("button", {
      name: /View message in #launch-room, thread: Other thread/,
    });
  expect(pill(second())).toBeNull();
  act(() => h.replies(replies, "error"));
  expect(within(first()).getByText("1 after you")).toBeInTheDocument();
  expect(pill(second())).toBeNull();
  act(() => h.replies(replies));
  expect(within(second()).getByText("You’re last")).toBeInTheDocument();
});

it("doesn't count a relay-signed reply in your name as someone else's", () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const h = harness();
  const Page = h.page.component;
  const t = NOW / 1000;
  h.emit([
    event({
      id: "8".repeat(64),
      content: "Thread reply",
      created_at: t - 300,
      tags: inThread,
    }),
  ]);
  h.replies([
    event({
      id: root,
      pubkey: friend,
      created_at: t - 900,
      content: "Root",
      tags: [team],
    }),
    event({
      id: "9".repeat(64),
      pubkey: relay,
      created_at: t - 100,
      content: "Via relay",
      tags: [...inThread, ["actor", viewer]],
    }),
  ]);
  render(<Page />);
  expect(
    within(screen.getByRole("button", { name: /Thread reply/ })).getByText(
      "You’re last",
    ),
  ).toBeInTheDocument();
});

it("keeps deletion reads running as replies arrive, and Refresh rereads them", () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const h = harness();
  const Page = h.page.component;
  const t = NOW / 1000;
  const reply = (n: number) =>
    event({
      id: String(n).repeat(64),
      pubkey: friend,
      created_at: t - 200 + n,
      content: `Reply ${n}`,
      tags: inThread,
    });
  const deletionViews = () =>
    h.contextViews.filter(
      (made) => JSON.stringify(made.filters[1]?.kinds) === "[5,9005]",
    );
  h.emit([
    event({
      id: "c".repeat(64),
      content: "Thread reply",
      created_at: t - 300,
      tags: inThread,
    }),
  ]);
  h.replies([reply(1)]);
  render(<Page />);
  expect(deletionViews()).toHaveLength(1);
  const first = deletionViews()[0];
  if (!first) throw new Error("expected a deletion view");
  // A new reply gets a read of its own; the one in flight keeps running.
  act(() => h.replies([reply(1), reply(2)]));
  expect(deletionViews()).toHaveLength(2);
  expect(first.dispose).not.toHaveBeenCalled();
  expect(deletionViews()[1]?.filters[0]?.ids).toEqual([reply(2).id]);
  // Refresh rereads deletions too, so ones missed during an outage come back.
  const before = deletionViews().map((made) => made.refresh.mock.calls.length);
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(deletionViews().map((made) => made.refresh.mock.calls.length)).toEqual(
    before.map((n) => n + 1),
  );
  expect(h.session.channels.refreshList).toHaveBeenCalled();
  // Replies arriving one by one: past eight small reads, they're rebuilt as one full read.
  const ids = [1, 2, 3, 4, 6, 7, 8, 9, 0];
  for (let n = 3; n <= ids.length; n++)
    act(() => h.replies(ids.slice(0, n).map(reply)));
  const live = deletionViews().filter(
    (made) => !made.dispose.mock.calls.length,
  );
  expect(first.dispose).toHaveBeenCalled();
  expect(live).toHaveLength(1);
  expect(new Set(live[0]?.filters[0]?.ids as string[])).toEqual(
    new Set(ids.map((n) => reply(n).id)),
  );
});

it("never says you're last when the host may have evicted older replies", () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const h = harness();
  const Page = h.page.component;
  const t = NOW / 1000;
  const busy = "1".repeat(64);
  const quiet = "2".repeat(64);
  h.emit([
    event({
      id: "3".repeat(64),
      content: "Quiet thread",
      created_at: t - 5000,
      tags: [team, ["e", quiet, "", "reply"]],
    }),
    event({
      id: "4".repeat(64),
      content: "Busy thread",
      created_at: t - 4000,
      tags: [team, ["e", busy, "", "reply"]],
    }),
  ]);
  // Three huge, newer agent replies fill the host's byte budget; the quiet thread's reply could be gone.
  const big = "x".repeat(2.5 * 1024 * 1024);
  h.replies(
    [1, 2, 3].map((i) =>
      event({
        id: `f${String(i).padStart(63, "0")}`,
        pubkey: scout,
        kind: 40002,
        created_at: t - 3000 + i,
        content: big,
        tags: [team, ["e", busy, "", "reply"]],
      }),
    ),
  );
  render(<Page />);
  expect(pill(screen.getByRole("button", { name: /Quiet thread/ }))).toBeNull();
  expect(
    within(screen.getByRole("button", { name: /Busy thread/ })).getByText(
      "3+ after you",
    ),
  ).toBeInTheDocument();
});

it("counts a post and your reply in its thread as one conversation awaiting you", () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const h = harness();
  const Page = h.page.component;
  const t = NOW / 1000;
  const post = "1".repeat(64);
  h.emit([
    event({
      id: "2".repeat(64),
      content: "Following up",
      created_at: t - 200,
      tags: [team, ["e", post, "", "reply"]],
    }),
    event({
      id: post,
      content: "Launch post",
      created_at: t - 900,
      tags: [team],
    }),
  ]);
  h.replies([
    event({
      id: "3".repeat(64),
      pubkey: friend,
      created_at: t - 100,
      content: "Reply",
      tags: [team, ["e", post, "", "reply"]],
    }),
  ]);
  render(<Page />);
  expect(
    within(screen.getByRole("button", { name: /Following up/ })).getByText(
      "1 after you",
    ),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("button", { name: /Launch post/ })).getByText(
      "1 reply",
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("1 with replies after yours")).toBeInTheDocument();
});

it("settles a post you answered in its thread: its reply count stays, but it isn't waiting on you", () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const h = harness();
  const Page = h.page.component;
  const t = NOW / 1000;
  const post = "1".repeat(64);
  const answer = event({
    id: "2".repeat(64),
    content: "Thanks, done",
    created_at: t - 100,
    tags: [team, ["e", post, "", "reply"]],
  });
  h.emit([
    answer,
    event({
      id: post,
      content: "Launch post",
      created_at: t - 900,
      tags: [team],
    }),
  ]);
  h.replies([
    event({
      id: "3".repeat(64),
      pubkey: friend,
      created_at: t - 500,
      content: "Question",
      tags: [team, ["e", post, "", "reply"]],
    }),
    answer,
  ]);
  render(<Page />);
  expect(
    within(screen.getByRole("button", { name: /Thanks, done/ })).getByText(
      "You’re last",
    ),
  ).toBeInTheDocument();
  const postRow = screen.getByRole("button", { name: /Launch post/ });
  expect(within(postRow).getByText("2 replies")).toBeInTheDocument();
  expect(postRow.querySelector('[data-tone="quiet"]')).toBeTruthy();
  expect(screen.queryByText(/with replies after yours/)).toBeNull();
});

it("stops counting a reply you deleted in its post's thread", () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const h = harness();
  const Page = h.page.component;
  const t = NOW / 1000;
  const post = "1".repeat(64);
  const mine = event({
    id: "2".repeat(64),
    content: "Oops",
    created_at: t - 100,
    tags: [team, ["e", post, "", "reply"]],
  });
  const reply = event({
    id: "3".repeat(64),
    pubkey: friend,
    created_at: t - 500,
    content: "Question",
    tags: [team, ["e", post, "", "reply"]],
  });
  const launch = event({
    id: post,
    content: "Launch post",
    created_at: t - 900,
    tags: [team],
  });
  h.emit([mine, launch]);
  h.replies([reply, mine]);
  render(<Page />);
  expect(
    within(screen.getByRole("button", { name: /Launch post/ })).getByText(
      "2 replies",
    ),
  ).toBeInTheDocument();
  act(() =>
    h.emit([
      event({
        id: "4".repeat(64),
        kind: 5,
        created_at: t - 50,
        content: "",
        tags: [team, ["e", mine.id], ["k", "9"]],
      }),
      mine,
      launch,
    ]),
  );
  expect(screen.queryByRole("button", { name: /Oops/ })).toBeNull();
  expect(
    within(screen.getByRole("button", { name: /Launch post/ })).getByText(
      "1 reply",
    ),
  ).toBeInTheDocument();
});

it("never says you're last when a capped read can't cover your message", () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const h = harness();
  const Page = h.page.component;
  const t = NOW / 1000;
  const busy = "1".repeat(64);
  const quiet = "2".repeat(64);
  h.emit([
    event({
      id: "3".repeat(64),
      content: "Quiet thread",
      created_at: t - 5000,
      tags: [team, ["e", quiet, "", "reply"]],
    }),
    event({
      id: "4".repeat(64),
      content: "Busy thread",
      created_at: t - 4000,
      tags: [team, ["e", busy, "", "reply"]],
    }),
  ]);
  // 500 newer replies in the busy thread fill the shared window; the quiet thread's reply is cut.
  const flood = Array.from({ length: 500 }, (_, i) =>
    event({
      id: `f${String(i).padStart(63, "0")}`,
      pubkey: scout,
      created_at: t - 3000 + i,
      tags: [team, ["e", busy, "", "reply"]],
    }),
  );
  h.replies(flood);
  render(<Page />);
  expect(pill(screen.getByRole("button", { name: /Quiet thread/ }))).toBeNull();
  // The busy thread's reply after yours is covered only partly: at least, not exactly.
  const busyRow = screen.getByRole("button", { name: /Busy thread/ });
  expect(within(busyRow).getByText("99+ after you")).toBeInTheDocument();
  expect(busyRow.getAttribute("aria-label")).toMatch(
    /At least 500 replies after yours/,
  );
  // Below the limit, the read is complete again.
  act(() => h.replies(flood.slice(-10)));
  expect(
    within(screen.getByRole("button", { name: /Quiet thread/ })).getByText(
      "You’re last",
    ),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("button", { name: /Busy thread/ })).getByText(
      "10 after you",
    ),
  ).toBeInTheDocument();
});

it("asks for a community before showing anything", () => {
  const connecting = { status: "connecting", generation: 0, session: {} };
  const Page = (() => {
    let registered: { component: ComponentType } | undefined;
    void apply({
      relay: { snapshot: () => connecting, subscribe: () => () => {} },
      navigation: {},
      pages: {
        register: (p: { component: ComponentType }) => {
          registered = p;
        },
      },
    } as unknown as Parameters<typeof apply>[0]);
    if (!registered) throw new Error("expected a registered page");
    return registered.component;
  })();
  render(<Page />);
  expect(screen.getByText("Choose a community")).toBeInTheDocument();
});
