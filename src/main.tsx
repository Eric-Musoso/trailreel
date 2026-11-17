import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import TrailreelPage from './pages/_index';

// Local entry point. The page and helpers are the same files the Floot-hosted app uses.
document.body.style.margin = '0';
document.body.style.background = '#0f1419';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TrailreelPage />
  </StrictMode>,
);
