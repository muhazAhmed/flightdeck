import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root — index.html is out of sync with main.tsx.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
