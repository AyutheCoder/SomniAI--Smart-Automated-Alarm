"use client";

import { Component, type ReactNode } from "react";
import { reportError } from "@/lib/errorReporter";

/**
 * One panel's failure stays in that panel (7.3). Without this, a panel that
 * throws while rendering (bad data from the server, a bug) takes the whole
 * home page down with it, and in a browser that page is what rings alarms.
 * The error is reported, the panel says so, and everything else keeps working.
 */
export default class PanelBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportError(error);
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <section role="alert" aria-label={`${this.props.name} failed`} className="mb-8 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5 text-sm text-amber-100">
        <p className="mb-2">
          {this.props.name} ran into a problem and couldn&apos;t be shown. It has been reported. Everything else on this page,
          alarms included, still works.
        </p>
        <button type="button" onClick={() => this.setState({ failed: false })} className="rounded-lg border border-amber-300/40 px-2.5 py-1 text-xs hover:bg-amber-500/10">
          Try again
        </button>
      </section>
    );
  }
}
