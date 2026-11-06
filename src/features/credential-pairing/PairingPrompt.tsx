import { useEffect, useRef, useState } from "react";
import { AlertDialog } from "../../shared/design-system/ui/AlertDialog";
import { Button } from "../../shared/design-system/ui/Button";
import {
  answerPairing,
  isSavedCommunity,
  onPairingEvents,
  type PairRequest,
} from "./service";

/** Asks the person to approve a command-line tool acting as them. A request
 * for a community they haven't saved here is refused without asking, and the
 * tool is told why. */
export function PairingPrompt({
  communities,
}: {
  communities: readonly string[];
}) {
  const [request, setRequest] = useState<PairRequest | null>(null);
  const [left, setLeft] = useState(0);
  const deny = useRef<HTMLButtonElement>(null);
  const saved = useRef(communities);
  saved.current = communities;
  useEffect(
    () =>
      onPairingEvents({
        request(next) {
          if (!isSavedCommunity(next.relay, saved.current)) {
            void answerPairing(next.id, "unsaved");
            return;
          }
          setRequest(next);
          setLeft(next.expiresIn);
        },
        closed(id) {
          setRequest((current) => (current?.id === id ? null : current));
        },
      }),
    [],
  );
  // Leaving the page declines what it was asked.
  const open = useRef<string | null>(null);
  open.current = request?.id ?? null;
  useEffect(
    () => () => {
      if (open.current) void answerPairing(open.current, "deny");
    },
    [],
  );
  useEffect(() => {
    if (!request) return;
    const timer = window.setInterval(
      () => setLeft((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [request]);
  // Native refuses it by now too; the prompt just closes.
  useEffect(() => {
    if (left === 0) setRequest(null);
  }, [left]);
  if (!request) return null;
  const answer = (approve: boolean) => {
    void answerPairing(request.id, approve ? "allow" : "deny");
    setRequest(null);
  };
  return (
    <AlertDialog
      title={
        <>
          <strong>{request.client}</strong> wants to use Buzz as you on{" "}
          <strong>{request.relay}</strong>
        </>
      }
      description="It can post and read as you. It can’t change your profile, contacts or memberships."
      initialFocus={deny}
      onClose={() => answer(false)}
      actions={
        <>
          <Button ref={deny} onClick={() => answer(false)}>
            Deny
          </Button>
          <Button variant="primary" onClick={() => answer(true)}>
            Allow
          </Button>
        </>
      }
    >
      <div className="min-w-0 space-y-2 text-body-sm">
        <p className="text-muted">
          {request.process
            ? `Requested by ${request.process}`
            : "Requested by an unknown process"}
        </p>
        <p className="text-muted" role="timer" aria-live="off">
          Expires in {left} s
        </p>
      </div>
    </AlertDialog>
  );
}
