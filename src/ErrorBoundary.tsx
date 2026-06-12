import { Component, type ReactNode } from 'react'

interface Props {
  /** Reset error state when this changes (e.g. the current page slug). */
  resetKey: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/** A broken page should never take down the app shell. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-3xl px-8 py-10">
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-5">
            <h2 className="text-base font-semibold text-destructive">This page failed to render</h2>
            <pre className="mt-3 overflow-x-auto text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
            <p className="mt-3 text-sm text-muted-foreground">
              Fix the page file and save — Vite will hot-reload it.
            </p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
