// Settings › Appearance (not drawn): System, Light or Night, kept on this device (the same choice as
// ⌘K's Appearance). On the phone a line says the Home Screen app keeps its own, as iOS keeps its
// storage apart from Safari's.
import {THEME_CHOICES, THEME_LABELS} from '../../logic/theme.ts';
import {Icon} from '../../ui/Icon.tsx';
import {usePhone} from '../Phone.tsx';
import {setThemeChoice, useThemeChoice} from '../theme.ts';
import {Page, Section} from './parts.tsx';

const ICONS = {system: 'contrast', light: 'light_mode', night: 'dark_mode'} as const;
const SUBS = {system: 'Follows this device\'s light or dark setting', light: 'Always light', night: 'Always dark'} as const;

export function AppearancePage() {
  const choice = useThemeChoice();
  const phone = usePhone();
  return (
    <Page title="Appearance">
      <Section label="Theme · this device">
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
        {phone && <p className="line">The Home Screen app keeps its own theme, apart from Safari’s.</p>}
      </Section>
    </Page>
  );
}
