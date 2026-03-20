import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app/App';

import '@/styles/global.css';
import '@/styles/tokens.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('ROOT_ELEMENT_NOT_FOUND');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
