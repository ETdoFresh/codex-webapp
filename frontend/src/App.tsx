import { useState } from 'react';
import StatusChip from './components/StatusChip';
import { useHealthStatus } from './hooks/useHealthStatus';

function App() {
  const [count, setCount] = useState(0);
  const health = useHealthStatus();

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Codex WebApp</h1>
          <p className="muted">Proxy + API + SPA demo workspace</p>
        </div>
        <StatusChip status={health.status} lastUpdated={health.lastUpdated} />
      </header>

      <main className="app-main">
        <section className="card">
          <h2>Counter</h2>
          <p>
            This counter verifies that the Vite + React + TypeScript pipeline is
            working.
          </p>
          <div className="counter">
            <span className="count">{count}</span>
            <div className="actions">
              <button type="button" onClick={() => setCount((value) => value + 1)}>
                Increment
              </button>
              <button
                type="button"
                onClick={() => setCount((value) => Math.max(0, value - 1))}
              >
                Decrement
              </button>
              <button type="button" onClick={() => setCount(0)}>
                Reset
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <h2>API Health</h2>
          <ul>
            <li>
              <strong>Status:</strong> {health.status.toUpperCase()}
            </li>
            <li>
              <strong>Last Checked:</strong>{' '}
              {health.lastUpdated?.toLocaleTimeString() ?? '—'}
            </li>
            <li>
              <strong>Details:</strong>{' '}
              {health.error ?? health.body?.message ?? 'Operational'}
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}

export default App;
