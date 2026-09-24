import React from 'react';

/*
 * Catches a render throw in the routed view, so one bad control costs that
 * view rather than a white page with no way back.
 *
 * The header sits outside it — brightness, off and the way home keep working
 * whatever the view below did. `resetKey` is the route: navigating anywhere
 * clears the error, which is what makes "Back to scenes" a recovery and not
 * just a link to a page that throws again from stale state.
 *
 * A class because error boundaries still have no hook equivalent.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error, info) {
    console.error('View crashed:', error, info && info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { onHome } = this.props;
    return (
      <div className="app-failure" role="alert">
        <p className="app-failure-title">This view hit a problem and stopped.</p>
        <p className="app-failure-detail">{error.message || String(error)}</p>
        <button
          type="button"
          className="btn"
          onClick={() => { this.setState({ error: null }); onHome(); }}
        >
          Back to scenes
        </button>
      </div>
    );
  }
}
