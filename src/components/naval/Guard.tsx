import { Component, type ReactNode } from "react";

/** Error isolation: one subsystem failing never blanks the page. */
export class Guard extends Component<{ name: string; children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    console.error(`[${this.props.name}] subsystem failed`, err);
  }
  override render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
