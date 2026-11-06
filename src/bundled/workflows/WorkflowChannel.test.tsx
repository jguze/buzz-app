// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { WorkflowChannel } from "./WorkflowChannel";
import {
  createWorkflowFixture,
  fixtureChannel,
  fixtureDefinition,
  fixtureViewer,
} from "./fixtures";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
afterEach(cleanup);

it("hands confirmed deletion to the page and discards draft navigation risk", async () => {
  const fixture = createWorkflowFixture();
  const remove = vi.fn();
  render(
    <WorkflowChannel
      capability={fixture.capability}
      channelId={fixtureChannel}
      channel={{ name: "Fixture channel" }}
      viewer={fixtureViewer}
      initialSelection={fixtureDefinition}
      onClose={() => {}}
      onDelete={remove}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "YAML" }));
  await user.type(
    screen.getByRole("textbox", { name: "Workflow YAML" }),
    "\n# Unsaved edit",
  );
  expect(
    window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "Workflow actions" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Delete workflow" }),
  );
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Delete workflow",
    }),
  );
  expect(remove).toHaveBeenCalledExactlyOnceWith(fixtureDefinition);
  expect(screen.queryByRole("dialog", { name: "Message helper" })).toBeNull();
  expect(
    screen.queryByRole("alertdialog", { name: "Leave this draft?" }),
  ).toBeNull();
  expect(
    window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
  ).toBe(true);
  expect(fixture.calls.delete).toBe(0);
});

it("keeps the open workflow visible without a refresh banner", async () => {
  const fixture = createWorkflowFixture();
  render(
    <WorkflowChannel
      capability={fixture.capability}
      channelId={fixtureChannel}
      channel={{ name: "Fixture channel" }}
      viewer={fixtureViewer}
      initialSelection={fixtureDefinition}
      onClose={() => {}}
      onDelete={() => {}}
    />,
  );
  const editor = await screen.findByRole("dialog", { name: "Message helper" });
  expect(
    within(editor).getByRole("textbox", { name: "Workflow name" }),
  ).toHaveValue("Message helper");
  act(() =>
    fixture.definitions.update({
      status: "loading",
      data: { items: [fixtureDefinition], partial: false },
    }),
  );
  expect(
    within(editor).getByRole("textbox", { name: "Workflow name" }),
  ).toHaveValue("Message helper");
  // Only the editor reports the reread; loaded items suppress the page banner.
  expect(screen.getAllByText("Reading configurations…")).toEqual([
    within(editor).getByText("Reading configurations…"),
  ]);
  const refresh = within(editor).getByRole("button", {
    name: "Refresh configurations",
  });
  expect(refresh).toBeDisabled();
  act(() =>
    fixture.definitions.update({
      status: "error",
      error: "Read failed",
      data: { items: [fixtureDefinition], partial: false },
    }),
  );
  expect(within(editor).getByRole("alert")).toHaveTextContent("Read failed");
  expect(refresh).toBeEnabled();
  expect(screen.getByRole("dialog", { name: "Message helper" })).toBe(editor);
});

it("releases a mounted run latch after unknown delivery without replaying it", async () => {
  const fixture = createWorkflowFixture();
  const remove = vi.fn();
  render(
    <WorkflowChannel
      capability={fixture.capability}
      channelId={fixtureChannel}
      channel={{ name: "Fixture channel" }}
      viewer={fixtureViewer}
      initialSelection={fixtureDefinition}
      onClose={() => {}}
      onDelete={remove}
    />,
  );
  const user = userEvent.setup();
  const action = async (name: string) => {
    await user.click(screen.getByRole("button", { name: "Workflow actions" }));
    await user.click(await screen.findByRole("menuitem", { name }));
  };
  const runNow = () => screen.getByRole("button", { name: "Run now" });
  await user.click(runNow());
  expect(fixture.calls.trigger).toBe(1);
  expect(runNow()).toBeDisabled();
  await user.click(runNow());
  expect(fixture.calls.trigger).toBe(1);
  act(() => fixture.finish("unknown"));
  expect(fixture.calls.trigger).toBe(1);
  expect(screen.getByText(/The run may have started/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Dismiss notice" }));
  await user.click(
    screen.getByRole("button", { name: "Dismiss notice and continue" }),
  );
  expect(fixture.capability.operations.snapshot()).toEqual([]);
  await user.click(runNow());
  expect(fixture.calls.trigger).toBe(2);
  act(() => fixture.finish("unknown"));
  await action("Delete workflow");
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Delete workflow",
    }),
  );
  expect(remove).toHaveBeenCalledExactlyOnceWith(fixtureDefinition);
});

it("runs despite a lost earlier run receipt, rereads open history on success and reports rejection", async () => {
  const fixture = createWorkflowFixture();
  // A journaled run whose receipt was lost (e.g. across a restart).
  act(() => {
    fixture.capability.trigger(fixtureDefinition);
    fixture.finish("unknown");
  });
  render(
    <WorkflowChannel
      capability={fixture.capability}
      channelId={fixtureChannel}
      channel={{ name: "Fixture channel" }}
      viewer={fixtureViewer}
      initialSelection={fixtureDefinition}
      onClose={() => {}}
      onDelete={() => {}}
    />,
  );
  const user = userEvent.setup();
  const run = async () => {
    const button = screen.getByRole("button", { name: "Run now" });
    expect(button).toBeEnabled();
    await user.click(button);
  };
  await user.click(screen.getByRole("tab", { name: "Runs" }));
  expect(fixture.calls.runs).toBe(1);
  await run();
  expect(fixture.calls.trigger).toBe(2);
  // A pending run explains the paused save without pointing at save recovery.
  expect(screen.getAllByText("Requesting a run…")[0]).toBeVisible();
  expect(screen.getByText(/Recent activity/)).toBeVisible();
  act(() => fixture.finish("succeeded"));
  expect(
    screen.getByText("Run requested. Inspect run history for its result."),
  ).toBeVisible();
  expect(fixture.calls.runs).toBe(2);
  await run();
  expect(fixture.calls.trigger).toBe(3);
  act(() => fixture.finish("rejected"));
  expect(screen.getByText("Failed to trigger workflow")).toBeVisible();
  expect(screen.getByText("Fixture conflict")).toBeVisible();
  // Delete stays available for the owner.
  await user.click(screen.getByRole("button", { name: "Workflow actions" }));
  expect(
    await screen.findByRole("menuitem", { name: "Delete workflow" }),
  ).not.toHaveAttribute("aria-disabled", "true");
});

it.each(["rejected", "unknown"] as const)(
  "recovers a restored %s run through durable dismissal",
  async (outcome) => {
    const fixture = createWorkflowFixture();
    fixture.capability.trigger(fixtureDefinition);
    fixture.finish(outcome);
    render(
      <WorkflowChannel
        capability={fixture.capability}
        channelId={fixtureChannel}
        channel={{ name: "Fixture channel" }}
        viewer={fixtureViewer}
        initialSelection={fixtureDefinition}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    const user = userEvent.setup();
    fixture.setDismissError("Journal unavailable");
    await user.click(screen.getByRole("tab", { name: "YAML" }));
    expect(
      screen.getByText(/Unsaved changes stay in this editor/),
    ).toBeVisible();
    expect(screen.getByText("Configuration details")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Dismiss notice" }));
    await user.click(
      screen.getByRole("button", { name: "Dismiss notice and continue" }),
    );
    expect(await screen.findByText("Journal unavailable")).toBeVisible();
    expect(fixture.capability.operations.snapshot()).toHaveLength(1);
    fixture.setDismissError(undefined);
    await user.click(
      screen.getByRole("button", { name: "Dismiss notice and continue" }),
    );
    expect(fixture.capability.operations.snapshot()).toEqual([]);
    expect(fixture.calls.trigger).toBe(1);
  },
);

it("runs once a newer head supersedes a save whose receipt was lost", async () => {
  const fixture = createWorkflowFixture();
  act(() => {
    fixture.capability.save({
      channelId: fixtureChannel,
      existing: fixtureDefinition,
      yaml: fixtureDefinition.yaml,
    });
    fixture.finish("unknown");
  });
  const head = {
    ...fixtureDefinition,
    revision: "bb".repeat(32),
    createdAt: fixtureDefinition.createdAt + 100,
  };
  render(
    <WorkflowChannel
      capability={fixture.capability}
      channelId={fixtureChannel}
      channel={{ name: "Fixture channel" }}
      viewer={fixtureViewer}
      initialSelection={head}
      onClose={() => {}}
      onDelete={() => {}}
    />,
  );
  const user = userEvent.setup();
  const run = await screen.findByRole("button", { name: "Run now" });
  expect(run).toBeEnabled();
  await user.click(run);
  expect(fixture.calls.trigger).toBe(1);
});

it("drops a run status when another configuration replaces the draft", async () => {
  const fixture = createWorkflowFixture();
  render(
    <WorkflowChannel
      capability={fixture.capability}
      channelId={fixtureChannel}
      channel={{ name: "Fixture channel" }}
      viewer={fixtureViewer}
      initialSelection={fixtureDefinition}
      onClose={() => {}}
      onDelete={() => {}}
    />,
  );
  const user = userEvent.setup();
  const runStatus = "Run requested. Inspect run history for its result.";
  await user.click(screen.getByRole("button", { name: "Run now" }));
  act(() => fixture.finish("succeeded"));
  expect(screen.getByText(runStatus)).toBeVisible();
  await user.type(
    screen.getByRole("textbox", { name: "Workflow name" }),
    " renamed",
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  // A different readback offers the current configuration in place of the draft.
  act(() => fixture.finish("succeeded", false));
  await user.click(
    screen.getByRole("button", { name: "Review current configuration" }),
  );
  await user.click(screen.getByRole("button", { name: "Leave draft" }));
  expect(screen.queryByText(runStatus)).not.toBeInTheDocument();
});

afterEach(() => vi.restoreAllMocks());
const webhookDefinition = {
  ...fixtureDefinition,
  yaml: fixtureDefinition.yaml.replace("on: message_posted", "on: webhook"),
};
const webhookUrl = `https://relay.example.test/hooks/${fixtureDefinition.id}`;
const beforeSaveHint =
  "Save to get this webhook’s URL and secret. The secret is shown only once.";
const triggerSettings = () =>
  screen.getByRole("complementary", { name: "Trigger settings" });
function mountChannel(
  initialSelection: Parameters<typeof WorkflowChannel>[0]["initialSelection"],
  fixture = createWorkflowFixture(),
  capability = fixture.capability,
) {
  render(
    <WorkflowChannel
      capability={capability}
      channelId={fixtureChannel}
      channel={{ name: "Fixture channel" }}
      viewer={fixtureViewer}
      initialSelection={initialSelection}
      onClose={() => {}}
      onDelete={() => {}}
    />,
  );
  // user-event installs its own clipboard stub; observe that one. The stub
  // outlives each test, so afterEach restores the spy.
  const user = userEvent.setup();
  return { fixture, user, copied: vi.spyOn(navigator.clipboard, "writeText") };
}

const readOnlySecretLine =
  "Senders include the X-Webhook-Secret header. Only the workflow’s author has the secret and can replace it.";

it.each([
  { viewer: "its author", owner: fixtureViewer, readOnly: false },
  { viewer: "another channel member", owner: "22".repeat(32), readOnly: true },
])(
  "shows a saved webhook's URL with Copy to $viewer, and who can replace the secret",
  async ({ owner, readOnly }) => {
    const { fixture, user, copied } = mountChannel({
      ...webhookDefinition,
      owner,
    });
    await user.click(
      screen.getByRole("button", { name: "Edit trigger: Webhook" }),
    );
    const aside = triggerSettings();
    expect(within(aside).getByText("Webhook URL")).toBeVisible();
    expect(within(aside).getByText(webhookUrl)).toBeVisible();
    expect(within(aside).queryByText(beforeSaveHint)).toBeNull();
    const shownOnce = within(aside).queryByText(
      /Buzz shows the secret only once, when it’s issued/,
    );
    const lostIt = within(aside).queryByText(/^Lost it\?/);
    if (readOnly) {
      expect(within(aside).getByText(readOnlySecretLine)).toBeVisible();
      expect(shownOnce).toBeNull();
      expect(lostIt).toBeNull();
    } else {
      expect(within(aside).queryByText(readOnlySecretLine)).toBeNull();
      expect(shownOnce).toBeVisible();
      expect(lostIt).toHaveTextContent(/Turn off Enabled in configuration/);
    }
    // One status line is mounted before anything is copied, so assistive
    // technology is already watching it.
    const status = within(aside).getByRole("status");
    expect(status).toBeEmptyDOMElement();
    // The address is outside the form's disabled fieldset, so Tab reaches Copy
    // URL for read-only viewers too, and Enter copies.
    const copy = within(aside).getByRole("button", { name: "Copy URL" });
    expect(copy).toBeEnabled();
    within(aside).getByRole("button", { name: "Close inspector" }).focus();
    await user.tab();
    expect(copy).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(copied).toHaveBeenCalledExactlyOnceWith(webhookUrl);
    await waitFor(() => expect(status).toHaveTextContent("URL copied."));
    expect(within(aside).getAllByRole("status")).toEqual([status]);
    expect(fixture.calls.take).toBe(0);
  },
);

it("reports a failed URL copy with how to recover", async () => {
  const { user, copied } = mountChannel(webhookDefinition);
  copied.mockRejectedValueOnce(new Error("Denied"));
  await user.click(
    screen.getByRole("button", { name: "Edit trigger: Webhook" }),
  );
  await user.click(
    within(triggerSettings()).getByRole("button", { name: "Copy URL" }),
  );
  await waitFor(() =>
    expect(within(triggerSettings()).getByRole("status")).toHaveTextContent(
      "Couldn’t copy the URL. Select it and copy it manually.",
    ),
  );
});

it("shows the relative hook route when the host has no relay HTTP base", async () => {
  const fixture = createWorkflowFixture();
  const { user } = mountChannel(webhookDefinition, fixture, {
    ...fixture.capability,
    webhookUrl: () => undefined,
  });
  await user.click(
    screen.getByRole("button", { name: "Edit trigger: Webhook" }),
  );
  const aside = triggerSettings();
  expect(within(aside).getByText("Webhook URL")).toBeVisible();
  expect(
    within(aside).getByText(`/hooks/${fixtureDefinition.id}`),
  ).toBeVisible();
  expect(within(aside).queryByRole("button", { name: "Copy URL" })).toBeNull();
  expect(within(aside).queryByText(beforeSaveHint)).toBeNull();
});

it.each([
  ["an unsaved workflow", "new" as const],
  ["a workflow saved with another trigger", fixtureDefinition],
])(
  "keeps the before-save hint, and no URL, for a webhook chosen on %s",
  async (_case, initialSelection) => {
    const { user } = mountChannel(initialSelection);
    if (initialSelection !== "new")
      await user.click(
        screen.getByRole("button", { name: "Edit trigger: Message posted" }),
      );
    await user.click(screen.getByRole("combobox", { name: "Trigger" }));
    await user.click(await screen.findByRole("option", { name: "Webhook" }));
    const aside = triggerSettings();
    expect(within(aside).getByText(beforeSaveHint)).toBeVisible();
    expect(within(aside).queryByText("Webhook URL")).toBeNull();
    expect(within(aside).queryByText(/\/hooks\//)).toBeNull();
    expect(
      within(aside).queryByRole("button", { name: "Copy URL" }),
    ).toBeNull();
  },
);

it("shows the URL once a save gives the workflow a webhook trigger, never the secret, and keeps Copy URL enabled during a later save", async () => {
  const secret = "fixture-webhook-secret-2f6c";
  const { fixture, user, copied } = mountChannel(fixtureDefinition);
  await user.click(
    screen.getByRole("button", { name: "Edit trigger: Message posted" }),
  );
  await user.click(screen.getByRole("combobox", { name: "Trigger" }));
  await user.click(await screen.findByRole("option", { name: "Webhook" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  // Until the readback, the saved definition still has the old trigger.
  expect(within(triggerSettings()).getByText(beforeSaveHint)).toBeVisible();
  act(() => fixture.finish("succeeded", true, secret));
  const aside = triggerSettings();
  expect(await within(aside).findByText(webhookUrl)).toBeVisible();
  expect(within(aside).queryByText(beforeSaveHint)).toBeNull();
  expect(document.body).not.toHaveTextContent(secret);
  expect(fixture.calls.take).toBe(0);

  await user.click(screen.getByRole("tab", { name: "YAML" }));
  await user.type(
    screen.getByRole("textbox", { name: "Workflow YAML" }),
    "\n# Unsaved edit",
  );
  await user.click(screen.getByRole("tab", { name: "Form" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await user.click(
    screen.getByRole("button", { name: "Edit trigger: Webhook" }),
  );
  // The pending save disables the form, not reading or copying its address.
  expect(
    within(triggerSettings()).getByRole("combobox", { name: "Trigger" }),
  ).toBeDisabled();
  const copy = () =>
    within(triggerSettings()).getByRole("button", { name: "Copy URL" });
  expect(copy()).toBeEnabled();
  await user.click(copy());
  expect(copied).toHaveBeenLastCalledWith(webhookUrl);
  // Accepted but not yet read back: the editor stays locked on the saved
  // definition, whose address can still be copied.
  const later = "fixture-webhook-secret-later";
  act(() => fixture.finish("succeeded", false, later));
  expect(
    screen.getByText(/Configuration saved; waiting for a readback/),
  ).toBeVisible();
  expect(
    within(triggerSettings()).getByRole("combobox", { name: "Trigger" }),
  ).toBeDisabled();
  expect(within(triggerSettings()).getByText(webhookUrl)).toBeVisible();
  expect(copy()).toBeEnabled();
  await user.click(copy());
  expect(copied).toHaveBeenCalledTimes(2);
  expect(copied).toHaveBeenLastCalledWith(webhookUrl);
  expect(document.body).not.toHaveTextContent(secret);
  expect(document.body).not.toHaveTextContent(later);
  expect(fixture.calls.take).toBe(0);
});

it("hides the URL while a step is selected or another trigger is chosen, and shows it again for Webhook", async () => {
  const { user } = mountChannel(webhookDefinition);
  await user.click(
    screen.getByRole("button", { name: "Edit trigger: Webhook" }),
  );
  expect(within(triggerSettings()).getByText(webhookUrl)).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Edit step 1: Send Message" }),
  );
  expect(
    screen.getByRole("complementary", { name: "Step 1 settings" }),
  ).toBeVisible();
  expect(screen.queryByText("Webhook URL")).toBeNull();
  expect(screen.queryByRole("button", { name: "Copy URL" })).toBeNull();

  await user.click(
    screen.getByRole("button", { name: "Edit trigger: Webhook" }),
  );
  await user.click(screen.getByRole("combobox", { name: "Trigger" }));
  await user.click(
    await screen.findByRole("option", { name: "Message posted" }),
  );
  expect(within(triggerSettings()).queryByText("Webhook URL")).toBeNull();
  expect(within(triggerSettings()).queryByText(beforeSaveHint)).toBeNull();

  // The saved definition still has the secret, so Webhook shows the address,
  // not the before-save hint.
  await user.click(screen.getByRole("combobox", { name: "Trigger" }));
  await user.click(await screen.findByRole("option", { name: "Webhook" }));
  expect(within(triggerSettings()).getByText(webhookUrl)).toBeVisible();
  expect(within(triggerSettings()).queryByText(beforeSaveHint)).toBeNull();
});

it("shows a saved webhook's URL on the YAML tab when Form mode can't show the definition", async () => {
  const { user, copied } = mountChannel({
    ...fixtureDefinition,
    yaml: `name: Hook reactions
enabled: true
trigger:
  on: webhook
steps:
  - id: react
    action: add_reaction
    emoji: "👍"
`,
  });
  expect(screen.getByRole("tab", { name: "YAML" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.queryByRole("button", { name: /^Edit trigger/ })).toBeNull();
  expect(screen.getByText("Webhook URL")).toBeVisible();
  expect(screen.getByTestId("webhook-address-url")).toHaveTextContent(
    webhookUrl,
  );
  await user.click(screen.getByRole("button", { name: "Copy URL" }));
  expect(copied).toHaveBeenCalledExactlyOnceWith(webhookUrl);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("URL copied."),
  );
});
