import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ChannelSummary } from "../../features/relay/contracts";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import { useChannelList, useRelayConnection } from "../../features/relay/react";
import { messageAuthor } from "../../features/relay/fold";
import type { Navigation } from "../../features/navigation/controller";
import { useIdentityNames } from "../../features/identity-names/react";
import { channelIcon } from "../../features/channels/channel-icon";
import { avatarMedia } from "../../shared/avatar-source";
import { relativeTimestamp } from "../../shared/relative-timestamp";
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CaretUpIcon,
  MessageReplyIcon,
  PencilSimpleIcon,
  SendIcon,
  SparklesIcon,
  CheckIcon,
  TrashIcon,
} from "../../shared/design-system/icons/index";
import { Avatar } from "../../shared/design-system/ui/Avatar";
import { AvatarStack } from "../../shared/design-system/ui/AvatarStack";
import { Button } from "../../shared/design-system/ui/Button";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import { FullPageSurface } from "../../shared/design-system/ui/FullPageSurface";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import {
  NavigationCard,
  NavigationItem,
} from "../../shared/design-system/ui/NavigationItem";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../shared/design-system/ui/PanelHeader";
import { SearchField } from "../../shared/design-system/ui/SearchField";
import {
  DELETION_KINDS,
  activityOf,
  contextFilters,
  indexContext,
  shapeOf,
  type Activity,
  type Shape,
} from "./context";
import { clearDraft, useDrafts } from "./drafts";
import {
  SENT_LIMIT,
  clockTime,
  dayLabel,
  fullTime,
  matches,
  preview,
  sentEntries,
  type Entry,
} from "./model";
import { draftListed, listed, scopeOf } from "./scope";
import { useActivity, useDeletions, useSent } from "./views";
import styles from "./DraftsSent.module.css";

/** Labels change by the minute, so half a minute keeps them current. */
const TICK_MS = 30_000;
type Place = {
  title: string;
  kind: "channel" | "dm" | "solo" | "unknown";
  /** The DM's other person, shown as the row's avatar. */
  person?: string | undefined;
  /** Everyone else in a DM or Solo chat. */
  members: readonly string[];
  available: boolean;
  channel: ChannelSummary | undefined;
};
type Status = {
  tone: "new" | "last" | "quiet";
  icon?: "reply" | "check";
  label: string;
  detail: string;
};
type Row = {
  entry: Entry;
  place: Place;
  shape: Shape;
  activity?: Activity | undefined;
  status?: Status | undefined;
  placeholder?: boolean | undefined;
};

/** The conversation a row's status is read from: its thread, its DM or Solo chat, or its post's replies. */
const conversationOf = ({ entry, shape }: { entry: Entry; shape: Shape }) =>
  shape === "thread"
    ? (entry.threadRootId ?? entry.id)
    : shape === "room"
      ? entry.channelId
      : entry.id;
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function DraftsSentPage({
  relay,
  navigator,
}: {
  relay: RelayData;
  navigator: Navigation;
}) {
  const connection = useRelayConnection(relay);
  const scope = scopeOf(connection);
  return (
    <div className="h-full min-h-0">
      <FullPageSurface aria-label="Drafts & sent">
        {connection.status === "ready" && scope ? (
          <ScopedPage
            key={`${connection.generation}:${connection.scope}`}
            session={connection.session}
            viewer={scope.viewer}
            origin={scope.communityOrigin}
            navigator={navigator}
          />
        ) : (
          <div data-buzz-ui="" className={styles.page}>
            <Header />
            <div className={styles.sections}>
              <EmptyState
                icon={<SendIcon size={24} />}
                title="Choose a community"
                description="Your drafts and sent messages appear once a community is selected."
              />
            </div>
          </div>
        )}
      </FullPageSurface>
    </div>
  );
}

function Header({ actions }: { actions?: React.ReactNode }) {
  return (
    <PanelHeader
      title={
        <PanelHeaderLabel
          title="Drafts & sent"
          icon={<SendIcon size="1rem" />}
        />
      }
      actions={actions}
    />
  );
}

function ScopedPage({
  session,
  viewer,
  origin,
  navigator,
}: {
  session: RelaySession;
  viewer: string;
  origin: string;
  navigator: Navigation;
}) {
  const drafts = useDrafts(session);
  const { channels } = useChannelList(session.channels);
  const profiles = useSyncExternalStore(
    session.profiles.subscribe,
    session.profiles.snapshot,
    session.profiles.snapshot,
  );
  const resolveName = useIdentityNames(session.names);
  const now = useNow();
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string>();
  const [showArchived, setShowArchived] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const { sent, refresh: refreshSent } = useSent(session, viewer);

  const byId = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel])),
    [channels],
  );
  const isRoom = (id: string) =>
    ["dm", "solo"].includes(byId.get(id)?.channelType ?? "");
  const nameOf = (key: string, candidates?: readonly string[]) =>
    key === viewer
      ? "You"
      : resolveName(
          key,
          profiles.get(key)?.name || "Unknown person",
          candidates,
        );

  function place(channelId: string): Place {
    const channel = byId.get(channelId);
    if (!channel)
      return {
        title: "Unavailable conversation",
        kind: "unknown",
        members: [],
        available: false,
        channel,
      };
    const available = !channel.cached && !channel.pending;
    const members = [
      ...new Set([...(channel.participants ?? []), ...(channel.members ?? [])]),
    ].filter((key) => key !== viewer);
    if (channel.channelType === "dm") {
      if (!members.length)
        return {
          title: "Notes to self",
          kind: "dm",
          person: viewer,
          members,
          available,
          channel,
        };
      const names = members.map((key) => nameOf(key, members));
      return {
        title:
          names.slice(0, 3).join(", ") +
          (names.length > 3 ? ` +${names.length - 3}` : ""),
        kind: "dm",
        person: members[0],
        members,
        available,
        channel,
      };
    }
    if (channel.channelType === "solo")
      return { title: channel.name, kind: "solo", members, available, channel };
    return {
      title: channel.private ? channel.name : `#${channel.name}`,
      kind: "channel",
      members: [],
      available,
      channel,
    };
  }

  const liveDrafts = drafts.entries.filter((entry) =>
    draftListed(byId.get(entry.channelId)),
  );
  // Left out unless asked for, after the live ones, so they can be found and cleared.
  const archivedDrafts = drafts.entries.filter((entry) => {
    const channel = byId.get(entry.channelId);
    return listed(channel) && channel?.archived;
  });
  const shownDrafts = showArchived
    ? [...liveDrafts, ...archivedDrafts]
    : liveDrafts;
  const sentList = useMemo(
    () =>
      sentEntries(sent.events, viewer).filter(
        (entry) =>
          byId.has(entry.channelId) && listed(byId.get(entry.channelId)),
      ),
    [sent.events, viewer, byId],
  );

  const { threads, rooms } = contextFilters(
    [...sentList, ...shownDrafts.filter((entry) => entry.threadRootId)],
    isRoom,
  );
  const context = useActivity(session, threads, rooms);
  // Others' messages, newest first, so a cap on deletion reads drops the oldest. Yours,
  // including ones the relay signed for you, are covered by your own deletions below.
  const othersKey = useMemo(
    () =>
      [
        ...new Map(
          context.events
            .filter(
              (event) => messageAuthor(event, session.relayAuthor) !== viewer,
            )
            .map((event) => [event.id, event]),
        ).values(),
      ]
        .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
        .map((event) => event.id)
        .join(","),
    [context.events, viewer, session],
  );
  const { deletions, refresh: refreshDeletions } = useDeletions(
    session,
    useMemo(() => (othersKey ? othersKey.split(",") : []), [othersKey]),
  );
  // Your own deletions come with Sent: a reply you deleted stops counting in its post's thread too.
  const ownDeletions = useMemo(
    () =>
      sent.events.filter(
        (event) =>
          event.pubkey === viewer && DELETION_KINDS.includes(event.kind),
      ),
    [sent.events, viewer],
  );
  const index = useMemo(
    () =>
      indexContext(
        context.events,
        [...deletions, ...ownDeletions],
        session.relayAuthor,
      ),
    [context.events, deletions, ownDeletions, session],
  );

  function status(row: Row, newest: boolean): Status | undefined {
    const { activity, shape, entry } = row;
    if (!activity) return undefined;
    // Only from a complete read of this conversation: no evidence, no status.
    const floor = context.ready.get(conversationOf(row));
    if (floor === undefined) return undefined;
    // The read is complete back to its floor. Before it, there may be more than it shows:
    // a count is a minimum, and "You're last" can't be known.
    const complete = entry.createdAt !== undefined && entry.createdAt > floor;
    const latest = activity.after[activity.after.length - 1];
    const from = latest
      ? `latest from ${nameOf(latest.author)}, ${relativeTimestamp(latest.created_at, now / 1000)}`
      : "";
    if (shape === "post") {
      if (!activity.replies) return undefined;
      const label = complete
        ? plural(activity.replies, "reply").replace("replys", "replies")
        : `${activity.replies}+ replies`;
      // The count stays, but your newer reply in its thread settles whether it's waiting on you.
      return {
        tone: newest && activity.after.length ? "new" : "quiet",
        icon: "reply",
        label,
        detail: from ? `${label}, ${from}` : label,
      };
    }
    // Older messages in a conversation you posted in again are settled by the newer one.
    if (!newest) return undefined;
    const word = shape === "thread" ? "reply" : "message";
    const words = shape === "thread" ? "replies" : "messages";
    const count = activity.after.length;
    if (!count)
      return complete
        ? {
            tone: "last",
            icon: "check",
            label: "You’re last",
            detail: `No ${words} after yours`,
          }
        : undefined;
    const shown = count > 99 ? "99+" : complete ? String(count) : `${count}+`;
    return {
      tone: "new",
      label: `${shown} after you`,
      detail: `${complete ? count : `At least ${count}`} ${count === 1 && complete ? word : words} after yours, ${from}`,
    };
  }

  const draftRows: Row[] = shownDrafts.map((entry) => {
    const where = place(entry.channelId);
    const shape = shapeOf(entry, isRoom(entry.channelId));
    // A draft has no send time: others' messages never count as "after" it.
    const { createdAt: _, ...unsent } = entry;
    return {
      entry,
      place: where,
      shape,
      placeholder: entry.placeholder,
      activity:
        shape === "post"
          ? undefined
          : activityOf(unsent, shape, index, viewer, where.members),
    };
  });
  const seen = new Set<string>();
  const sentRows: Row[] = sentList.map((entry) => {
    const where = place(entry.channelId);
    const shape = shapeOf(entry, isRoom(entry.channelId));
    const row: Row = {
      entry,
      place: where,
      shape,
      activity: activityOf(entry, shape, index, viewer, where.members),
    };
    const conversation = conversationOf(row);
    row.status = status(row, !seen.has(conversation));
    seen.add(conversation);
    return row;
  });
  // A post and your reply in its thread are one conversation.
  const waiting = new Set(
    sentRows.filter((row) => row.status?.tone === "new").map(conversationOf),
  ).size;

  // Everyone shown in a row, so their names and pictures load.
  const people = new Set<string>();
  for (const row of [...draftRows, ...sentRows])
    for (const key of row.activity?.people.slice(0, 4) ??
      row.place.members.slice(0, 3))
      people.add(key);
  const missing = [...people]
    .sort()
    .filter((key) => !profiles.has(key))
    .slice(0, 200)
    .join(",");
  useEffect(() => {
    if (missing)
      void session.profiles.ensure(missing.split(",")).catch(() => {});
  }, [session, missing]);

  const text = (row: Row) =>
    row.placeholder ? row.entry.text : preview(row.entry.text, "Attachment");
  const visibleDrafts = draftRows.filter((row) =>
    matches(text(row), row.place.title, search),
  );
  const visibleSent = sentRows.filter((row) =>
    matches(text(row), row.place.title, search),
  );
  const sentLoading =
    (sent.status === "loading" || sent.status === "idle") &&
    !sent.events.length;

  async function open(entry: Entry, draft: boolean) {
    setNotice(undefined);
    try {
      const result = await navigator.open({
        version: 1,
        kind: "conversation",
        scope: { viewer, communityOrigin: origin },
        channelId: entry.channelId,
        ...(entry.threadRootId ? { threadRootId: entry.threadRootId } : {}),
        ...(draft
          ? entry.threadRootId
            ? { messageId: entry.threadRootId }
            : {}
          : { messageId: entry.id }),
      });
      if (result.status === "failed")
        setNotice(
          "This conversation could not be opened. It may have been removed, or your access may have changed.",
        );
    } catch {
      setNotice("This conversation could not be opened. Try again.");
    }
  }

  /** Clears one draft and keeps keyboard focus in the list: the next row's clear
   * action, else the previous one's, else search. */
  function clear(entry: Entry, button: HTMLElement) {
    setNotice(undefined);
    const row = button.closest("li");
    const neighbor = (
      row?.nextElementSibling ?? row?.previousElementSibling
    )?.querySelector<HTMLElement>("[data-clear-draft]");
    try {
      clearDraft(session, entry.id);
    } catch {
      setNotice("This draft could not be cleared. Try again.");
      return;
    }
    (neighbor ?? searchInput.current)?.focus();
  }

  function lead(place: Place) {
    if (place.kind === "dm" && place.person) {
      const profile = profiles.get(place.person);
      return (
        <Avatar
          src={avatarMedia(profile?.picture, session.media)}
          alt=""
          fallback={place.title}
          size="small"
          shape={profile?.isAgent ? "squircle" : "circle"}
        />
      );
    }
    const Icon =
      place.kind === "solo" ? SparklesIcon : channelIcon(place.channel);
    return (
      <span className={styles.tile} data-kind={place.kind} aria-hidden="true">
        <Icon size={16} />
      </span>
    );
  }

  function stack(activity: Activity | undefined, place: Place) {
    // A one-to-one DM already shows its person as the row's avatar.
    const keys = activity?.people ?? place.members;
    const shown = place.kind === "dm" && keys.length <= 1 ? [] : keys;
    if (!shown.length) return null;
    return (
      <AvatarStack
        size="mini"
        items={shown.map((key) => {
          const profile = profiles.get(key);
          return {
            id: key,
            name: nameOf(key),
            src: avatarMedia(profile?.picture, session.media),
            shape: profile?.isAgent ? "squircle" : "circle",
          };
        })}
      />
    );
  }

  function row(item: Row, draft: boolean) {
    const { entry, place, activity, status } = item;
    const line = text(item);
    const time = entry.createdAt
      ? draft
        ? relativeTimestamp(entry.createdAt, now / 1000)
        : clockTime(entry.createdAt)
      : "";
    const archived = draft && place.channel?.archived;
    const where = `${place.title}${archived ? ", archived" : ""}${entry.threadRootId ? ", thread" : ""}`;
    const involved = (activity?.people ?? place.members)
      .slice(0, 5)
      .map((key) => nameOf(key));
    const label = [
      `${draft ? (archived ? "Open conversation" : "Continue draft") : "View message"} in ${where}: ${line}`,
      status?.detail,
      involved.length && place.kind !== "dm"
        ? `With ${involved.join(", ")}`
        : undefined,
    ]
      .filter(Boolean)
      .join(". ");
    const destination = (
      <NavigationItem
        multiline
        aria-label={label}
        disabled={!place.available}
        title={
          place.available
            ? undefined
            : "This conversation is not available right now"
        }
        onClick={() => void open(entry, draft)}
        icon={<span className={styles.lead}>{lead(place)}</span>}
        label={
          <span className={styles.main}>
            <span className={styles.head}>
              <span className={`text-label-sm ${styles.name}`}>
                {place.title}
              </span>
              {entry.threadRootId && (
                <span className={`text-caption ${styles.chip}`}>
                  <MessageReplyIcon size={12} />
                  Thread
                </span>
              )}
              {place.kind === "solo" && (
                <span className={`text-caption ${styles.chip}`}>Solo</span>
              )}
              {archived && (
                <span className={`text-caption ${styles.chip}`}>Archived</span>
              )}
            </span>
            <span
              className={`text-body-sm ${status?.tone === "new" ? "text-standard" : "text-subtle"} ${styles.preview}`}
              data-placeholder={item.placeholder || undefined}
            >
              {draft && <span className={styles.draftMark}>Draft</span>}
              {line}
            </span>
            <span className={styles.context}>
              {stack(activity, place)}
              {status && (
                <span
                  className={`text-caption ${styles.pill}`}
                  data-tone={status.tone}
                  title={status.detail}
                >
                  {status.icon === "reply" ? (
                    <MessageReplyIcon size={12} />
                  ) : status.icon === "check" ? (
                    <CheckIcon size={12} />
                  ) : (
                    <span className={styles.dot} />
                  )}
                  {status.label}
                </span>
              )}
            </span>
          </span>
        }
        trailing={
          time && entry.createdAt !== undefined ? (
            <time
              className={`text-caption ${styles.time}`}
              dateTime={new Date(entry.createdAt * 1000).toISOString()}
              title={fullTime(entry.createdAt)}
            >
              {time}
            </time>
          ) : undefined
        }
      />
    );
    return (
      <li className={styles.row} key={entry.id}>
        {draft ? (
          <NavigationCard>
            {destination}
            <span className={styles.clear}>
              <IconButton
                variant="destructive-quiet"
                icon={<TrashIcon size={16} aria-hidden="true" />}
                aria-label={`Clear draft in ${where}: ${line}`}
                title="Clear draft"
                data-clear-draft=""
                onClick={(event) => clear(entry, event.currentTarget)}
              />
            </span>
          </NavigationCard>
        ) : (
          destination
        )}
      </li>
    );
  }

  const groups: { label: string; rows: Row[] }[] = [];
  for (const item of visibleSent) {
    const label = dayLabel(item.entry.createdAt ?? 0, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.rows.push(item);
    else groups.push({ label, rows: [item] });
  }
  const refresh = () => {
    session.channels.refreshList?.();
    refreshSent.current();
    context.refresh.current();
    refreshDeletions.current();
  };

  return (
    <div data-buzz-ui="" className={styles.page}>
      <Header
        actions={
          <IconButton
            icon={<ArrowsClockwiseIcon size={16} />}
            aria-label="Refresh"
            title="Refresh"
            disabled={sent.status === "loading"}
            onClick={refresh}
          />
        }
      />
      <div className={styles.toolbar}>
        <SearchField
          variant="capsule"
          value={search}
          onValueChange={setSearch}
          label="Search drafts and sent messages"
          placeholder="Search drafts and sent messages"
          inputRef={searchInput}
        />
      </div>
      {notice && (
        <p role="alert" className={styles.notice}>
          {notice}
        </p>
      )}
      <div className={styles.sections}>
        <section
          aria-labelledby="drafts-sent-drafts"
          className={styles.section}
        >
          <InlineHeader
            id="drafts-sent-drafts"
            icon={<PencilSimpleIcon size={16} />}
            title={
              <span className={styles.groupHeading}>
                Drafts
                {liveDrafts.length ? (
                  <span className={`text-caption text-subtle ${styles.count}`}>
                    {liveDrafts.length}
                  </span>
                ) : null}
              </span>
            }
          />
          {drafts.unavailable && (
            <p role="alert" className="text-body-sm text-subtle">
              Some saved drafts could not be read. They are unchanged.
            </p>
          )}
          {visibleDrafts.length ? (
            <ul className={styles.list} aria-label="Drafts">
              {visibleDrafts.map((item) => row(item, true))}
            </ul>
          ) : (
            <p className="text-body-sm text-subtle">
              {search && shownDrafts.length
                ? `No drafts match “${search.trim()}”.`
                : archivedDrafts.length
                  ? "No drafts outside archived conversations."
                  : "No drafts. Messages you start and don’t send wait here."}
            </p>
          )}
          {archivedDrafts.length > 0 && (
            <div className={styles.archivedToggle}>
              <Button
                variant="plain"
                size="sm"
                aria-expanded={showArchived}
                onClick={() => setShowArchived((shown) => !shown)}
              >
                {showArchived ? (
                  <CaretUpIcon size={14} aria-hidden="true" />
                ) : (
                  <CaretDownIcon size={14} aria-hidden="true" />
                )}
                {showArchived
                  ? "Hide archived"
                  : `Show archived (${archivedDrafts.length})`}
              </Button>
            </div>
          )}
          {drafts.limited && (
            <p className="text-caption text-subtle">Showing 500 drafts.</p>
          )}
        </section>
        <section aria-labelledby="drafts-sent-sent" className={styles.section}>
          <InlineHeader
            id="drafts-sent-sent"
            icon={<SendIcon size={16} />}
            title="Sent"
            actions={
              waiting ? (
                <span
                  className={`text-caption ${styles.pill}`}
                  data-tone="new"
                  title={`${plural(waiting, "conversation")} with replies after yours`}
                >
                  <span className={styles.dot} />
                  {waiting} with replies after yours
                </span>
              ) : undefined
            }
          />
          {sent.status === "error" && (
            <div role="alert" className={styles.notice}>
              <p>Sent messages could not be loaded.</p>
              <Button size="sm" onClick={() => refreshSent.current()}>
                Retry
              </Button>
            </div>
          )}
          {/* The status row is reserved only while nothing is shown; once Sent loads it
              would leave a blank line under the heading. */}
          <LoadingRegion
            pending={sentLoading}
            label="Loading sent messages…"
            statusVisibility={sentLoading ? "visible" : "screen-reader"}
          >
            {groups.length ? (
              groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <p className={`text-caption text-subtle ${styles.day}`}>
                    {group.label}
                  </p>
                  <ul className={styles.list}>
                    {group.rows.map((item) => row(item, false))}
                  </ul>
                </section>
              ))
            ) : sentLoading || sent.status === "error" ? null : search ? (
              <EmptyState
                icon={<SendIcon size={24} />}
                title={`No sent messages match “${search.trim()}”`}
                description={`Search covers your latest ${SENT_LIMIT} messages.`}
                action={
                  <Button
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      searchInput.current?.focus();
                    }}
                  >
                    Clear search
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<SendIcon size={24} />}
                title="Nothing sent yet"
                description="Messages you send in this community show up here."
              />
            )}
          </LoadingRegion>
          {sentRows.length >= SENT_LIMIT && (
            <p className="text-caption text-subtle">
              Showing your latest {SENT_LIMIT} messages.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
