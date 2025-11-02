import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppSimplified from './AppSimplified';
import './index.css';
import { AuthProvider } from './context/AuthContext';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Unable to find root element');
}

createRoot(container).render(
  <StrictMode>
    <AuthProvider>
      <AppSimplified />
    </AuthProvider>
  </StrictMode>
);
