import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import './theme/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');
const root = createRoot(container);

// HashRouter chosen over BrowserRouter so packaged builds (file:// URL)
// don't need a server-side rewrite to handle deep links.
root.render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
