import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ProfileDraftProvider } from './ProfilePanel';
import './styles.css';
import './rule-library.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><ProfileDraftProvider><App /></ProfileDraftProvider></React.StrictMode>);
