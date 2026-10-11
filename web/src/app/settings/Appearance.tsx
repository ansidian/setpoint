// Settings › Appearance (not drawn): System, Light or Night, kept in this browser (DESIGN.md ›
// Settings; the same choice as ⌘K's Appearance).
import {THEME_CHOICES, THEME_LABELS} from '../../logic/theme.ts';
import {Icon} from '../../ui/Icon.tsx';
import {setThemeChoice, useThemeChoice} from '../theme.ts';
import {Page, Section} from './parts.tsx';

const ICONS = {system: 'contrast', light: 'light_mode', night: 'dark_mode'} as const;
const SUBS = {system: 'Follows this computer\'s light or dark setting', light: 'Always light', night: 'Always dark'} as const;

export function AppearancePage() {
  const choice = useThemeChoice();
  return (
    <Page title="Appearance">
      <Section label="Theme · this browser">
        <div className="set-group" role="radiogroup" aria-label="Theme">
          {THEME_CHOICES.map(option => (
            <button key={option} type="button" role="radio" aria-checked={choice === option} className="set-row" style={{width: '100%', textAlign: 'left'}}
              onClick={() => setThemeChoice(option)}>
              <span className="aico"><Icon name={ICONS[option]} size={16} /></span>
              <div className="lines grow"><span className="t">{THEME_LABELS[option]}</span><span className="s">{SUBS[option]}</span></div>
              {choice === option && <Icon name="check" />}
            </button>
          ))}
        </div>
      </Section>
    </Page>
  );
}
