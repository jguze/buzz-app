// Adapted from block/buzz desktop workflow helpers at b9392d9d.
import { isMap, parseDocument } from "yaml";

import { DEFAULT_FORM_STATE, formStateToYaml } from "./workflowFormTypes";

/**
 * Header-level view of a workflow definition.
 *
 * The dialog header (name, name editing, enabled toggle) must stay usable while
 * the body of the definition is still incomplete — a freshly added step has no
 * message text yet, so full form validation fails even though `name` is present
 * and editable. These fields therefore come from the YAML document itself
 * rather than from {@link yamlToFormState}.
 */
export type WorkflowDocumentFields = {
  /** Whether top-level keys can be written back into the document. */
  editable: boolean;
  /** The explicit `enabled` value, or `null` when the key is absent. */
  enabled: boolean | null;
  /** The top-level `name` scalar, or `null` when absent or not a string. */
  name: string | null;
};

const EMPTY_DOCUMENT_FIELDS: WorkflowDocumentFields = {
  editable: true,
  enabled: null,
  name: null,
};

const UNEDITABLE_DOCUMENT_FIELDS: WorkflowDocumentFields = {
  editable: false,
  enabled: null,
  name: null,
};

/**
 * Reads the header-level fields of a workflow definition without requiring the
 * whole definition to be valid.
 */
export function readWorkflowDocumentFields(
  yaml: string,
): WorkflowDocumentFields {
  if (!yaml.trim()) return EMPTY_DOCUMENT_FIELDS;

  const document = parseDocument(yaml);
  if (document.errors.length > 0 || !isMap(document.contents)) {
    return UNEDITABLE_DOCUMENT_FIELDS;
  }

  const name = document.get("name");
  const enabled = document.get("enabled");
  return {
    editable: true,
    enabled: typeof enabled === "boolean" ? enabled : null,
    name: typeof name === "string" ? name : null,
  };
}

/**
 * The definition's `trigger.on`, read without requiring the whole definition to
 * be valid. Aliases resolve, as they do on the relay.
 */
export function readWorkflowTriggerOn(yaml: string): string | null {
  const document = parseDocument(yaml);
  if (document.errors.length > 0) return null;
  let on: unknown;
  try {
    on = document.toJS()?.trigger?.on;
  } catch {
    // toJS throws on excessive aliases (a resource exhaustion attack).
    return null;
  }
  return typeof on === "string" ? on : null;
}

/** Writes `name` into the definition, preserving unrelated YAML nodes (not byte-exact formatting). */
export function yamlWithWorkflowName(
  yaml: string,
  name: string,
): string | null {
  if (!yaml.trim()) {
    return formStateToYaml({ ...DEFAULT_FORM_STATE, name });
  }

  const document = parseDocument(yaml);
  if (document.errors.length > 0 || !isMap(document.contents)) return null;
  document.set("name", name);
  return document.toString();
}

/** Writes `enabled` into the definition, preserving unrelated YAML nodes (not byte-exact formatting). */
export function yamlWithWorkflowEnabled(
  yaml: string,
  enabled: boolean,
): string | null {
  if (!yaml.trim()) {
    return formStateToYaml({ ...DEFAULT_FORM_STATE, enabled });
  }

  const document = parseDocument(yaml);
  if (document.errors.length > 0 || !isMap(document.contents)) return null;
  if (enabled) {
    document.delete("enabled");
  } else {
    document.set("enabled", false);
  }
  return document.toString();
}
