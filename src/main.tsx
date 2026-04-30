import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { startWorkspacePersistence } from './lib/persistence';
import './styles/global.css';

// Block on hydration so the first paint reflects the persisted workspace
// (sessions, panes, open tabs). startWorkspacePersistence is idempotent.
startWorkspacePersistence().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
});
