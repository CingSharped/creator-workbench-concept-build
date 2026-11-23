import { forwardRef } from "react";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  DetailsHTMLAttributes,
  HTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from "react";

function classNames(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function Panel({ children, className, ...props }: PanelProps): JSX.Element {
  return (
    <section className={classNames("cw-panel", className)} {...props}>
      {children}
    </section>
  );
}

export interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function Card({ children, className, ...props }: CardProps): JSX.Element {
  return (
    <article className={classNames("cw-card", className)} {...props}>
      {children}
    </article>
  );
}

export interface PanelHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function PanelHeader({ children, className, ...props }: PanelHeaderProps): JSX.Element {
  return (
    <div className={classNames("cw-panel-header", className)} {...props}>
      {children}
    </div>
  );
}

export type WorkbenchStatusTone = "ready" | "success" | "warning" | "error" | "editing" | "info" | "muted";

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: WorkbenchStatusTone;
}

export function StatusBadge({ children, tone = "muted", className, ...props }: StatusBadgeProps): JSX.Element {
  return (
    <span className={classNames("cw-status-badge", tone, className)} {...props}>
      {children}
    </span>
  );
}

export interface SegmentedTabsProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function SegmentedTabs({ children, className, ...props }: SegmentedTabsProps): JSX.Element {
  return (
    <div className={classNames("cw-tabs", className)} {...props}>
      {children}
    </div>
  );
}

export interface DisclosureProps extends DetailsHTMLAttributes<HTMLDetailsElement> {
  children: ReactNode;
  summary: ReactNode;
}

export function Disclosure({ children, summary, className, ...props }: DisclosureProps): JSX.Element {
  return (
    <details className={classNames("cw-disclosure", className)} {...props}>
      <summary>{summary}</summary>
      <div className="cw-disclosure-content">{children}</div>
    </details>
  );
}

export interface FieldProps extends LabelHTMLAttributes<HTMLLabelElement> {
  children: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
}

export function Field({ children, label, hint, className, ...props }: FieldProps): JSX.Element {
  return (
    <label className={classNames("cw-field", className)} {...props}>
      <span className="cw-field-label">{label}</span>
      {children}
      {hint ? <span className="cw-field-hint">{hint}</span> : null}
    </label>
  );
}

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function ScrollArea({ children, className, ...props }: ScrollAreaProps): JSX.Element {
  return (
    <div className={classNames("cw-scroll-area", className)} {...props}>
      {children}
    </div>
  );
}

export type WorkbenchButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: WorkbenchButtonVariant;
  compact?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", compact = false, className, ...props },
  ref,
): JSX.Element {
  return (
    <button
      ref={ref}
      className={classNames("cw-button", `cw-button-${variant}`, compact && "cw-button-compact", className)}
      {...props}
    />
  );
});

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: WorkbenchButtonVariant;
  compact?: boolean;
}

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = "secondary", compact = false, className, ...props },
  ref,
): JSX.Element {
  return (
    <a
      ref={ref}
      className={classNames("cw-button", `cw-button-${variant}`, compact && "cw-button-compact", className)}
      {...props}
    />
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ className, ...props }, ref): JSX.Element {
  return <button ref={ref} className={classNames("cw-icon-button", className)} {...props} />;
});
