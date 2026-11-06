import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../shared/design-system/ui/Button";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { ConfirmAction } from "./ConfirmAction";
import { writeClipboardText } from "../../shared/clipboard";

/** Shown when the user leaves before revealing or copying; the relay cannot re-issue the secret. */
export const continueWithoutSecret = {
  title: "Continue without this secret?",
  description:
    "This private webhook secret cannot be recovered. Copy and store it before continuing, or explicitly leave it behind.",
  action: "Continue",
  cancel: "Go back",
};

type CopyNotice = { text: string; error: boolean };

/** Copies a webhook value; the result belongs in that surface's one {@link CopyStatus}. */
function useWebhookCopy() {
  const [notice, setNotice] = useState<CopyNotice>();
  const copy = async (value: string, label: "URL" | "secret") => {
    // A live region announces changes, so clear it first: repeating a copy
    // repeats the announcement.
    setNotice(undefined);
    try {
      await writeClipboardText(value);
      setNotice({
        text: `${label === "URL" ? "URL" : "Secret"} copied.`,
        error: false,
      });
      return true;
    } catch {
      setNotice({
        text:
          label === "secret"
            ? "Couldn’t copy the secret. Reveal it and copy it manually."
            : "Couldn’t copy the URL. Select it and copy it manually.",
        error: true,
      });
      return false;
    }
  };
  return [notice, copy] as const;
}

/** Always mounted, so assistive technology is watching before its text changes. */
function CopyStatus({ notice }: { notice: CopyNotice | undefined }) {
  return (
    <p
      role="status"
      className={`workflow-copy-status text-body-sm ${notice?.error ? "text-danger" : "text-secondary"}`}
    >
      {notice?.text}
    </p>
  );
}

/** The relay route senders post to; `hookUrl` is undefined when the host advertised no relay HTTP base. */
function WebhookUrl({
  workflowId,
  hookUrl,
  testId,
  onCopy,
}: {
  workflowId: string;
  hookUrl: string | undefined;
  testId: string;
  onCopy: (url: string) => void;
}) {
  return (
    <>
      <p className="text-label-sm">Webhook URL</p>
      {hookUrl ? (
        <div className="workflow-secret-row">
          <code
            className="workflow-secret-value text-mono-sm"
            data-testid={testId}
          >
            {hookUrl}
          </code>
          <Button size="compact" onClick={() => onCopy(hookUrl)}>
            Copy URL
          </Button>
        </div>
      ) : (
        <p className="text-body-sm text-secondary">
          The relay’s HTTP address is unavailable from this host. Send requests
          to <code>/hooks/{workflowId}</code> on the relay.
        </p>
      )}
    </>
  );
}

/** Where a saved webhook's address appears, which decides how to point at the Enabled switch. */
export type WebhookAddressSurface = "trigger-settings" | "yaml";

/**
 * A saved webhook trigger's address, outside Webhook ready. The relay returns
 * the secret only in the save receipt that issues it, so this never reads or
 * shows it.
 */
export function WorkflowWebhookAddress({
  workflowId,
  hookUrl,
  readOnly,
  surface,
}: {
  workflowId: string;
  hookUrl: string | undefined;
  /** Only the author can save, so only the author can replace the secret. */
  readOnly: boolean;
  /**
   * Trigger settings hides the panel with the Enabled switch until it closes;
   * on the YAML tab the switch is directly above.
   */
  surface: WebhookAddressSurface;
}) {
  const [notice, copy] = useWebhookCopy();
  return (
    <div className="workflow-secret workflow-webhook-address">
      <WebhookUrl
        workflowId={workflowId}
        hookUrl={hookUrl}
        testId="webhook-address-url"
        onCopy={(url) => void copy(url, "URL")}
      />
      <CopyStatus notice={notice} />
      {readOnly ? (
        <p className="text-body-sm text-subtle">
          Senders include the X-Webhook-Secret header. Only the workflow’s
          author has the secret and can replace it.
        </p>
      ) : (
        <>
          <p className="text-body-sm text-subtle">
            Senders include the X-Webhook-Secret header. Buzz shows the secret
            only once, when it’s issued, and can’t show it again.
          </p>
          <p className="text-body-sm text-subtle">
            {surface === "yaml"
              ? "Lost it? Turn off Enabled in configuration above, change the trigger and save."
              : "Lost it? Close these settings, turn off Enabled in configuration, change the trigger and save."}{" "}
            The old secret stops working. Then change the trigger back to
            Webhook, turn Enabled in configuration on and save to get a new
            secret.
          </p>
        </>
      )}
    </div>
  );
}

/** One-time display of a webhook secret. The value lives in component state only. */
export function WorkflowWebhookSecretDialog({
  workflowId,
  hookUrl,
  take,
  onContinue,
}: {
  workflowId: string;
  /** Display address, or undefined when the host advertised no relay HTTP base. */
  hookUrl: string | undefined;
  /** One-shot hand-off from the capability; called once, when this dialog mounts. */
  take: () => string | undefined;
  onContinue: () => void;
}) {
  const id = useId();
  const [secret, setSecret] = useState<string>();
  const [revealed, setRevealed] = useState(false);
  const [handled, setHandled] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, copy] = useWebhookCopy();
  const taken = useRef(false);
  useEffect(() => {
    // StrictMode re-runs mount effects on the same instance; the ref keeps the
    // hand-off single-shot so a second pass cannot take nothing and lose it.
    if (taken.current) return;
    taken.current = true;
    const value = take();
    if (value !== undefined) setSecret(value);
  }, [take]);
  const copySecret = async (value: string) => {
    if (await copy(value, "secret")) setHandled(true);
  };
  const leave = () => {
    if (secret === undefined || handled) onContinue();
    else setConfirming(true);
  };
  return (
    <>
      <Dialog
        open
        dismissOnOutsideClick={false}
        onOpenChange={(open) => {
          if (!open) leave();
        }}
        title="Webhook ready"
        description="This private secret is shown once and cannot be recovered. Copy and store it before continuing."
        actions={
          <Button variant="primary" onClick={leave}>
            Continue
          </Button>
        }
      >
        <div className="workflow-secret">
          <WebhookUrl
            workflowId={workflowId}
            hookUrl={hookUrl}
            testId="webhook-url"
            onCopy={(url) => void copy(url, "URL")}
          />
          <p id={`${id}-secret`} className="text-label-sm">
            X-Webhook-Secret header
          </p>
          <div className="workflow-secret-row">
            <code
              className="workflow-secret-value text-mono-sm"
              data-testid="webhook-secret"
            >
              {secret === undefined
                ? "Unavailable"
                : revealed
                  ? secret
                  : "•".repeat(24)}
            </code>
            <Button
              size="compact"
              aria-label={
                revealed ? "Hide webhook secret" : "Reveal webhook secret"
              }
              disabled={secret === undefined}
              onClick={() => {
                setRevealed((value) => !value);
                setHandled(true);
              }}
            >
              {revealed ? "Hide" : "Reveal"}
            </Button>
            <Button
              size="compact"
              disabled={secret === undefined}
              onClick={() => secret !== undefined && void copySecret(secret)}
            >
              Copy secret
            </Button>
          </div>
          {secret === undefined && (
            <p role="alert" className="text-body-sm text-danger">
              This secret is no longer available from this session.
            </p>
          )}
          <CopyStatus notice={notice} />
        </div>
      </Dialog>
      {confirming && (
        <ConfirmAction
          {...continueWithoutSecret}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onContinue();
          }}
        />
      )}
    </>
  );
}
