import assert from "node:assert/strict";
import { test } from "vitest";

import {
  readWorkflowDocumentFields,
  readWorkflowTriggerOn,
  yamlWithWorkflowEnabled,
  yamlWithWorkflowName,
} from "./workflowYamlDocument.ts";

// A step that has just been added from the builder carries no message text yet,
// so the definition fails full form validation while the user is still on the
// step pane. The header must keep working against that document.
const INCOMPLETE_STEP_YAML = `name: mock-horse-battery
trigger:
  on: message_posted
steps:
  - id: step_1
    action: send_message
`;

test("reads the name of a definition whose steps are still incomplete", () => {
  assert.deepEqual(readWorkflowDocumentFields(INCOMPLETE_STEP_YAML), {
    editable: true,
    enabled: null,
    name: "mock-horse-battery",
  });
  assert.equal(
    readWorkflowDocumentFields(INCOMPLETE_STEP_YAML).name,
    "mock-horse-battery",
  );
});

test("treats an empty definition as an editable blank name", () => {
  assert.deepEqual(readWorkflowDocumentFields(""), {
    editable: true,
    enabled: null,
    name: null,
  });
  assert.deepEqual(readWorkflowDocumentFields("   \n"), {
    editable: true,
    enabled: null,
    name: null,
  });
  assert.equal(readWorkflowDocumentFields("").name, null);
});

test("marks unparseable or non-map documents as uneditable", () => {
  assert.deepEqual(readWorkflowDocumentFields("name: [unclosed\n"), {
    editable: false,
    enabled: null,
    name: null,
  });
  assert.deepEqual(readWorkflowDocumentFields("- just\n- a list\n"), {
    editable: false,
    enabled: null,
    name: null,
  });
  assert.equal(yamlWithWorkflowName("- just\n- a list\n", "next"), null);
  assert.equal(yamlWithWorkflowEnabled("- just\n- a list\n", false), null);
});

test("ignores a non-string name rather than rendering it", () => {
  assert.equal(readWorkflowDocumentFields("name: 42\n").name, null);
});

test("writes the name back without disturbing the rest of the document", () => {
  const next = yamlWithWorkflowName(INCOMPLETE_STEP_YAML, "renamed");
  assert.equal(readWorkflowDocumentFields(next).name, "renamed");
  assert.match(next, /action: send_message/);
  assert.match(next, /on: message_posted/);
});

test("seeds a definition when naming an empty document", () => {
  const next = yamlWithWorkflowName("", "fresh");
  assert.equal(readWorkflowDocumentFields(next).name, "fresh");
  assert.match(next, /trigger:/);
});

test("adds and removes the enabled key without touching the name", () => {
  const disabled = yamlWithWorkflowEnabled(INCOMPLETE_STEP_YAML, false);
  assert.match(disabled, /enabled: false/);
  assert.equal(readWorkflowDocumentFields(disabled).name, "mock-horse-battery");

  const reEnabled = yamlWithWorkflowEnabled(disabled, true);
  assert.doesNotMatch(reEnabled, /enabled:/);
  assert.equal(
    readWorkflowDocumentFields(reEnabled).name,
    "mock-horse-battery",
  );
});

test("naming a new document cannot activate it", () => {
  assert.equal(
    readWorkflowDocumentFields(yamlWithWorkflowName("", "Fresh")).enabled,
    false,
  );
});

test("header edits preserve advanced YAML and comments without form ownership", () => {
  const yaml =
    "# keep\nname: Advanced\ntrigger: {on: schedule, cron: '0 9 * * *'}\nsteps: [{id: call, action: call_webhook, url: 'https://example.com', headers: {X-Custom: keep}}]\nfuture: untouched\n";
  const renamed = yamlWithWorkflowName(yaml, "Renamed");
  const disabled = yamlWithWorkflowEnabled(renamed, false);
  for (const source of [renamed, disabled]) {
    assert.match(source, /# keep/);
    assert.match(source, /X-Custom: keep/);
    assert.match(source, /future: untouched/);
    assert.match(source, /on: schedule/);
  }
});

test("reads the trigger type of a definition Form mode cannot show", () => {
  assert.equal(
    readWorkflowTriggerOn(
      "name: Hook\ntrigger:\n  on: webhook\nsteps:\n  - id: react\n    action: add_reaction\n",
    ),
    "webhook",
  );
  assert.equal(readWorkflowTriggerOn(INCOMPLETE_STEP_YAML), "message_posted");
  // Aliases resolve, as they do on the relay.
  assert.equal(
    readWorkflowTriggerOn("hook: &hook webhook\ntrigger:\n  on: *hook\n"),
    "webhook",
  );
  assert.equal(
    readWorkflowTriggerOn("base: &base\n  on: webhook\ntrigger: *base\n"),
    "webhook",
  );
  for (const yaml of [
    "",
    "- webhook",
    "trigger: [",
    "trigger: webhook",
    "trigger:\n  on: 4",
    // Too many aliases to resolve safely.
    "a: &a [x, x, x, x, x, x, x, x, x, x]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]\ntrigger:\n  on: webhook\n",
  ])
    assert.equal(readWorkflowTriggerOn(yaml), null, yaml);
});
