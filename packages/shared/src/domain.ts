export const POSITION_ORDER = [
  'GOL',
  'LE',
  'ZAG',
  'LD',
  'VOL',
  'MC',
  'MEI',
  'ME',
  'MD',
  'PE',
  'PD',
  'ATA',
] as const;
export type PositionCode = (typeof POSITION_ORDER)[number];
export const POSITION_LABELS: Record<PositionCode, string> = {
  GOL: 'GK',
  LE: 'LB',
  ZAG: 'CB',
  LD: 'RB',
  VOL: 'CDM',
  MC: 'CM',
  MEI: 'CAM',
  ME: 'LM',
  MD: 'RM',
  PE: 'LW',
  PD: 'RW',
  ATA: 'ST',
};
export type SquadType = 'FIRST_TEAM' | 'YOUTH';
export type SelectionMode = 'LATEST_IN_CAREER' | 'PINNED_SAVE';
export type IdentityStatus = 'CONFIRMED' | 'UNCONFIRMED' | 'ERROR';
export interface PlayerImage {
  source: 'LIVE_EDITOR' | 'MANUAL';
  hash: string;
  url: string;
  updatedAt: string;
}
export interface CareerPlayer {
  attributes?: Record<string, number | null>;
  rawRatings?: {
    overall: number | null;
    potential: number | null;
    attributes: Record<string, number | null>;
  };
  internalKey: string;
  playerId: number;
  displayName: string;
  squadType: SquadType;
  age: number | null;
  birthDate: string | null;
  primaryPosition: PositionCode | null;
  secondaryPositions: PositionCode[];
  overall: number | null;
  potential: number | null;
  growthMargin: number | null;
  contractEndYear: number | null;
  weeklyWage: number | null;
  appearances: number | null;
  minutes: number | null;
  averageRating: number | null;
  nationality: string | null;
  image?: PlayerImage;
  imageEligible: boolean;
}
export interface Integrity {
  firstTeamExpected: number;
  firstTeamResolved: number;
  youthExpected: number;
  youthResolved: number;
  ambiguousCount: number;
  unresolvedCount: number;
}
export interface Issue {
  code: string;
  message: string;
  selectedRecordKey?: string;
  playerId?: number;
  squadType?: SquadType;
  candidates?: {
    recordKey: string;
    displayName: string;
    birthDate: string | null;
    overall: number | null;
    player?: CareerPlayer;
  }[];
}
export interface Metadata {
  clubNameSource?: 'SAVE' | 'USER' | 'UNRESOLVED';
  clubNameMethod?: 'TEAM_TABLE' | 'CUSTOM_METADATA' | null;
  clubNameEvidence?: string[];
  inGameDateSource?: 'USER' | null;
  clubId: number | null;
  clubName: string;
  inGameDate: string | null;
  careerIdentifier: string | null;
  identityStatus: IdentityStatus;
  evidence: string[];
  warnings: string[];
}
export interface ParsedSave {
  careerDateInfo?: CareerDateInfo;
  normalizationVersion?: number;
  metadata: Metadata;
  players: CareerPlayer[];
  integrity: Integrity;
  issues: Issue[];
  decisions: { playerId: number; reason: string }[];
  source?: { fileName: string; modifiedAt: string; size: number };
}
export interface SaveEntry {
  id: string;
  careerId: string;
  fileName: string;
  modifiedAt: string;
  size: number;
  hash: string | null;
  metadata: Metadata;
  error: string | null;
  missing: boolean;
  changed: boolean;
}
export interface Career {
  id: string;
  identityStatus: IdentityStatus;
  clubName: string;
  saveCount: number;
  latestSave: SaveEntry;
  evidence: string[];
}
export interface Selection {
  careerId: string;
  saveId: string;
  mode: SelectionMode;
}
export interface Current {
  careerId: string;
  save: SaveEntry;
  latestSave: SaveEntry | null;
  mode: SelectionMode;
  snapshotId: string | null;
  createdAt: string | null;
  data: ParsedSave | null;
  imageWarnings: string[];
  changes: { added: number; removed: number } | null;
}
export interface Settings {
  saveDirectory: string;
  headDirectory: string;
  youthHeadDirectory: string;
  autoImages: boolean;
  gameDirectory: string;
}
export interface Diagnostics {
  node: string;
  python: boolean;
  pillow: boolean;
  parser: boolean;
  globalNames: boolean;
  saveDirectory: boolean;
  headDirectory: boolean;
  youthHeadDirectory: boolean;
}
export type SortField =
  | 'secondaryPositions'
  | 'displayName'
  | 'birthDate'
  | 'age'
  | 'primaryPosition'
  | 'overall'
  | 'potential'
  | 'growthMargin'
  | 'weeklyWage'
  | 'contractEndYear'
  | 'appearances'
  | 'minutes'
  | 'averageRating';
export function sortPlayers(
  players: CareerPlayer[],
  field: SortField,
  direction: 'asc' | 'desc' | 'none',
): CareerPlayer[] {
  if (direction === 'none') return [...players];
  return [...players].sort((a, b) => {
    const av = field === 'secondaryPositions' ? a.secondaryPositions.join(', ') || null : a[field],
      bv = field === 'secondaryPositions' ? b.secondaryPositions.join(', ') || null : b[field];
    if (av == null && bv == null) return a.internalKey.localeCompare(b.internalKey);
    if (av == null) return 1;
    if (bv == null) return -1;
    let cmp: number;
    if (field === 'primaryPosition') {
      cmp = POSITION_ORDER.indexOf(av as PositionCode) - POSITION_ORDER.indexOf(bv as PositionCode);
      if (cmp === 0)
        return (
          (b.overall ?? -1) - (a.overall ?? -1) || a.displayName.localeCompare(b.displayName, 'en')
        );
    } else
      cmp =
        typeof av === 'string' && typeof bv === 'string'
          ? av.localeCompare(bv, 'en')
          : Number(av) - Number(bv);
    return cmp * (direction === 'asc' ? 1 : -1) || a.internalKey.localeCompare(b.internalKey);
  });
}

export function isValidDate(input: string | null | undefined): input is string {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
  const parsed = new Date(`${input}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === input;
}
export function formatBirthDate(input: string | null | undefined): string {
  if (!isValidDate(input)) return '—';
  const [year, month, day] = input.split('-');
  return `${day}/${month}/${year}`;
}
export function ageAt(birthDate: string | null, careerDate: string | null): number | null {
  if (!isValidDate(birthDate) || !isValidDate(careerDate) || careerDate < birthDate) return null;
  const age =
    Number(careerDate.slice(0, 4)) -
    Number(birthDate.slice(0, 4)) -
    (careerDate.slice(5) < birthDate.slice(5) ? 1 : 0);
  return age <= 100 ? age : null;
}
export function validClubName(name: string): boolean {
  const text = name.trim();
  return (
    text.length > 0 &&
    text.length <= 100 &&
    ![...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    !/create[ -]?(?:a[ -]?)?club|placeholder|teamname|\[do not use\]/i.test(text) &&
    !/^[*<]/.test(text) &&
    ![
      'unidentified club',
      'unnamed club',
      'unknown',
      'n/a',
      'team name',
      'club name',
      'unnamed',
    ].includes(text.toLowerCase())
  );
}
export interface CareerSettings {
  careerId: string;
  teamId: number | null;
  saveId: string;
  clubName: string;
  clubNameSource: 'SAVE' | 'USER' | 'UNRESOLVED';
  automaticClubName?: boolean;
}
export interface CareerDateInfo {
  lastMatchDate: string | null;
  nextMatchDate: string | null;
  referenceDate: string | null;
  referenceDateSource: 'SAVE_LAST_MATCH' | 'MATCH_HISTORY' | 'UNAVAILABLE';
}
export const unavailableCareerDate = (): CareerDateInfo => ({
  lastMatchDate: null,
  nextMatchDate: null,
  referenceDate: null,
  referenceDateSource: 'UNAVAILABLE',
});
export function compareRatings(previous: CareerPlayer, current: CareerPlayer) {
  if (previous.internalKey !== current.internalKey) return null;
  return {
    overall:
      previous.overall == null || current.overall == null
        ? null
        : current.overall - previous.overall,
    potential:
      previous.potential == null || current.potential == null
        ? null
        : current.potential - previous.potential,
  };
}
