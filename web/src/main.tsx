import './styles.css';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {Root} from './app/Root.tsx';
// After every component's own styles, so the phone's layout wins below 640 px.
import './phone.css';
import {startTheme} from './app/theme.ts';
import {applyTokens} from './tokens.ts';

applyTokens(document.documentElement);
startTheme(document.documentElement);
createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
