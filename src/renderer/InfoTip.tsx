import type { ReactNode } from "react";

interface InfoTipProps {
  label?: string;
  children: ReactNode;
}

export default function InfoTip({ label = "More information", children }: InfoTipProps): JSX.Element {
  return (
    <span className="info-tip" tabIndex={0} aria-label={label}>
      <span className="info-tip-trigger" aria-hidden="true">i</span>
      <span className="info-tip-popover" role="tooltip">{children}</span>
    </span>
  );
}
