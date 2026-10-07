import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import en from './locales/en.json';
import es from './locales/es.json';
import ptBR from './locales/pt-BR.json';
import {
  isValidDate,
  POSITION_LABELS,
  type PositionCode as Position,
} from '../../../packages/shared/src/domain';

export type Locale = 'en' | 'es' | 'pt-BR';
export type TranslationKey = keyof typeof en;
const catalogs: Record<Locale, Record<TranslationKey, string>> = { en, es, 'pt-BR': ptBR };
const storageKey = 'fc26.interface-language';
export const languages: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
];
export const isLocale = (value: unknown): value is Locale =>
  value === 'en' || value === 'es' || value === 'pt-BR';

export function translate(
  locale: Locale,
  key: TranslationKey,
  params: Record<string, string | number> = {},
) {
  return catalogs[locale][key].replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : token,
  );
}

export function localizeMessage(locale: Locale, text: string): string {
  const prefix = text.startsWith('Error: ') ? 'Error: ' : '';
  const message = text.slice(prefix.length);
  return (
    prefix + (Object.hasOwn(en, message) ? translate(locale, message as TranslationKey) : message)
  );
}

const attributeLabels: Record<string, TranslationKey> = {
  acceleration: 'Acceleration',
  sprint_speed: 'Sprint speed',
  agility: 'Agility',
  balance: 'Balance',
  jumping: 'Jumping',
  strength: 'Strength',
  stamina: 'Stamina',
  aggression: 'Aggression',
  interceptions: 'Interceptions',
  att_position: 'Attacking position',
  reactions: 'Reactions',
  vision: 'Vision',
  composure: 'Composure',
  gk_diving: 'GK diving',
  gk_reflexes: 'GK reflexes',
  gk_kicking: 'GK kicking',
  gk_handling: 'GK handling',
  gk_positioning: 'GK positioning',
  ball_control: 'Ball control',
  crossing: 'Crossing',
  curve: 'Curve',
  def_awareness: 'Defensive awareness',
  dribbling: 'Dribbling',
  finishing: 'Finishing',
  fk_accuracy: 'Free kick accuracy',
  heading_accuracy: 'Heading accuracy',
  long_passing: 'Long passing',
  long_shots: 'Long shots',
  penalties: 'Penalties',
  short_passing: 'Short passing',
  shot_power: 'Shot power',
  sliding_tackle: 'Sliding tackle',
  standing_tackle: 'Standing tackle',
  volleys: 'Volleys',
};

const regionalLocale = (locale: Locale) =>
  locale === 'en' ? 'en-GB' : locale === 'es' ? 'es-ES' : locale;

export function formatDate(value: string | null | undefined, locale: Locale) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'N/A'
    : parsed.toLocaleString(regionalLocale(locale), {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}

export function formatCalendarDate(value: string | null | undefined, locale: Locale) {
  if (!isValidDate(value)) return 'N/A';
  // Calendar dates have no timezone: keep the day stored in the save.
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? 'N/A'
    : parsed.toLocaleDateString(regionalLocale(locale), {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

const spanishPositions: Record<Position, string> = {
  GOL: 'POR',
  LE: 'LI',
  ZAG: 'DFC',
  LD: 'LD',
  VOL: 'MCD',
  MC: 'MC',
  MEI: 'MCO',
  ME: 'MI',
  MD: 'MD',
  PE: 'EI',
  PD: 'ED',
  ATA: 'DC',
};

function readLocale(): Locale {
  try {
    const saved = localStorage.getItem(storageKey);
    return isLocale(saved) ? saved : 'en';
  } catch {
    return 'en';
  }
}

const LanguageContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
} | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(readLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(storageKey, locale);
    } catch {
      /* Keep working when storage is blocked. */
    }
  }, [locale]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey) updateLocale(isLocale(event.newValue) ? event.newValue : 'en');
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return (
    <LanguageContext.Provider value={{ locale, setLocale: updateLocale }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('LanguageProvider is required');
  const { locale } = context;
  return {
    ...context,
    t: (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(locale, key, params),
    message: (text: string) => localizeMessage(locale, text),
    attribute: (name: string) =>
      attributeLabels[name] ? translate(locale, attributeLabels[name]) : name.replaceAll('_', ' '),
    date: (value: string | null | undefined) => formatDate(value, locale),
    formatBirthDate: (value: string | null | undefined) => formatCalendarDate(value, locale),
    money: (value: number | null) =>
      value == null
        ? 'N/A'
        : value.toLocaleString(regionalLocale(locale), { maximumFractionDigits: 0 }),
    number: (value: number, digits = 0) =>
      value.toLocaleString(regionalLocale(locale), {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }),
    position: (value: Position) =>
      locale === 'pt-BR'
        ? value
        : locale === 'es'
          ? spanishPositions[value]
          : POSITION_LABELS[value],
  };
}
