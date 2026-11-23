import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./WorkbenchPrimitives";

interface ConfirmActionDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  acknowledgementLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}

export default function ConfirmActionDialog({
  title,
  body,
  confirmLabel,
  destructive = false,
  acknowledgementLabel,
  onCancel,
  onConfirm,
  children
}: ConfirmActionDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const canConfirm = !acknowledgementLabel || acknowledged;

  useEffect(() => {
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = [cancelButtonRef.current, confirmButtonRef.current].filter(Boolean) as HTMLElement[];
      if (focusable.length === 0) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex + 1) % focusable.length;
      event.preventDefault();
      focusable[nextIndex]?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="confirmation-modal cw-card" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
        <div className="panel-header cw-panel-header">
          <div>
            <h2 id="confirmation-title">{title}</h2>
            <p className="muted">{body}</p>
          </div>
        </div>
        {children ? <div className="confirmation-modal-content">{children}</div> : null}
        {acknowledgementLabel ? (
          <label className="confirmation-acknowledgement">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>{acknowledgementLabel}</span>
          </label>
        ) : null}
        <div className="confirmation-modal-actions">
          <Button ref={cancelButtonRef} className="secondary-button" variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <button
            ref={confirmButtonRef}
            className={destructive ? "danger-button" : "primary-button"}
            type="button"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
