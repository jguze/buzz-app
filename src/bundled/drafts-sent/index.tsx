import type { PluginModule } from "../../plugins/api";
import { useChannelList, useRelayConnection } from "../../features/relay/react";
import { DraftsSentPage } from "./DraftsSentPage";
import { useDrafts } from "./drafts";
import { draftListed } from "./scope";
import styles from "./DraftsSent.module.css";

export const inject = ["pages", "relay", "navigation"];

export const apply: PluginModule["apply"] = (ctx) => {
  const relay = ctx.relay;

  /** Sidebar count of unsent drafts in the current community, leaving out archived conversations. */
  function Badge() {
    const connection = useRelayConnection(relay);
    const session =
      connection.status === "ready" ? connection.session : undefined;
    const drafts = useDrafts(session);
    const { channels } = useChannelList(connection.session.channels);
    const count = session
      ? drafts.entries.filter((entry) =>
          draftListed(
            channels.find((channel) => channel.id === entry.channelId),
          ),
        ).length
      : 0;
    return count ? (
      <span
        className={styles.badge}
        role="img"
        aria-label={`${count} draft${count === 1 ? "" : "s"}`}
      >
        {count > 999 ? "999+" : count}
      </span>
    ) : null;
  }

  ctx.pages.register({
    id: "drafts-sent",
    title: "Drafts & sent",
    layout: "workspace",
    primary: true,
    badge: Badge,
    component: () => (
      <DraftsSentPage relay={relay} navigator={ctx.navigation} />
    ),
  });
};
