import React from 'react';
import { createRoot } from 'react-dom/client';  // Note the change here: import createRoot
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import './index.css';

// Optionally, import your global CSS here
// import './index.css';

const container = document.getElementById('root');
const root = createRoot(container); // creates a root.
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);