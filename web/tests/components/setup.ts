// Every component test draws in the app's stylesheets on its tokens, in Night, as main.tsx does.
import '../../src/styles.css';
import '../../src/phone.css';
import {applyTheme, applyTokens} from '../../src/tokens.ts';

applyTokens(document.documentElement);
applyTheme(document.documentElement, 'night');
