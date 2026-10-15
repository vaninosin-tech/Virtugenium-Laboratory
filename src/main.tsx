// Must run before any model preload starts — see the module's own doc.
import './features/lab-boot/lib/assetTracker';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import './global.css';
import './shared/ui/gameCursor.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
