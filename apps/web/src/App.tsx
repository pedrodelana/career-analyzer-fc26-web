import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  Clock3,
  Download,
  FolderOpen,
  Grid2X2,
  LayoutDashboard,
  List,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Upload,
  UserRound,
  Users,
  AlertTriangle,
  Database,
  HardDrive,
  Library,
  ChevronRight,
  X,
} from 'lucide-react';
import type {
  Career,
  SaveEntry,
  Selection,
  Current,
  CareerPlayer,
  Settings,
  Diagnostics,
  SquadType,
  SortField,
  ParsedSave,
  Issue,
} from '../../../packages/shared/src/domain';
import {
  POSITION_ORDER,
  sortPlayers,
  type CareerSettings,
} from '../../../packages/shared/src/domain';
import { api } from './api';
import { useI18n, languages, isLocale } from './i18n';

type Page = 'library' | 'overview' | 'first' | 'youth' | 'development' | 'settings';
type Filter = {
  search: string;
  position: string;
  ageMin: string;
  ageMax: string;
  ovrMin: string;
  ovrMax: string;
  potMin: string;
  potMax: string;
  sort: SortField;
  direction: 'asc' | 'desc' | 'none';
  cards: boolean;
};
const initialFilter = (): Filter => ({
  search: '',
  position: '',
  ageMin: '',
  ageMax: '',
  ovrMin: '',
  ovrMax: '',
  potMin: '',
  potMax: '',
  sort: 'primaryPosition',
  direction: 'asc',
  cards: false,
});
const value = (input: number | string | null | undefined) => input ?? 'N/A';
const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
function Avatar({ player, large = false }: { player: CareerPlayer; large?: boolean }) {
  const { t } = useI18n();
  return (
    <span className={`avatar ${large ? 'large' : ''}`}>
      {player.image ? (
        <img
          src={player.image.url}
          alt={t('{player} portrait', { player: player.displayName })}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <UserRound size={large ? 54 : 22} />
      )}
    </span>
  );
}
function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'amber';
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}

function CareerSettingsForm({
  settings,
  disabled,
  openAfterSave,
  error,
  onClose,
  onSave,
}: {
  settings: CareerSettings;
  disabled: boolean;
  openAfterSave: boolean;
  error: string;
  onClose: () => void;
  onSave: (values: { saveId: string; clubName?: string }) => Promise<void>;
}) {
  const { t, message } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [clubName, setClubName] = useState(settings.clubName);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="career-dialog"
      aria-labelledby="career-settings-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!disabled) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({
            saveId: settings.saveId,
            ...(clubName.trim() !== settings.clubName || settings.clubNameSource === 'UNRESOLVED'
              ? { clubName: clubName.trim() }
              : {}),
          });
        }}
      >
        <div className="panel-heading">
          <h2 id="career-settings-title">{t('Career settings')}</h2>
          <button
            type="button"
            className="text-button"
            aria-label={t('Close career settings')}
            disabled={disabled}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {error && (
          <p className="banner error" role="alert">
            {message(error)}
          </p>
        )}
        <div className="settings-fields">
          <label>
            {t('Club name')}{' '}
            <input
              autoFocus
              required
              maxLength={100}
              value={clubName}
              disabled={disabled}
              readOnly={settings.automaticClubName}
              onChange={(e) => setClubName(e.target.value)}
            />
            <small>
              {settings.automaticClubName
                ? t(
                    'Name recovered automatically from this save. Manual naming is available if extraction fails.',
                  )
                : settings.clubNameSource === 'UNRESOLVED'
                  ? t('The save has no verified club name. Enter it to open this career.')
                  : t('Name source: ') +
                    (settings.clubNameSource === 'USER' ? t('entered by you') : t('save file')) +
                    '.'}{' '}
              {t('Saved for this career only.')}{' '}
            </small>
          </label>
          <p className="muted">
            {t(
              'Player ages are calculated automatically as of the last completed match found in the save. No date entry is needed.',
            )}{' '}
          </p>
        </div>
        <div className="settings-submit">
          <button type="button" className="button" onClick={onClose} disabled={disabled}>
            {t('Cancel')}{' '}
          </button>
          <button className="button primary" type="submit" disabled={disabled || !clubName.trim()}>
            {openAfterSave ? t('Save & open') : t('Save career settings')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function App() {
  const { t, date, formatBirthDate, number, message } = useI18n();
  const [page, setPage] = useState<Page>('library');
  const [careers, setCareers] = useState<Career[]>([]);
  const [previous, setPrevious] = useState<Selection | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saveList, setSaveList] = useState<SaveEntry[]>([]);
  const [savePicker, setSavePicker] = useState(false);
  const [player, setPlayer] = useState<CareerPlayer | null>(null);
  const [filters, setFilters] = useState({ first: initialFilter(), youth: initialFilter() });
  const [careerEditor, setCareerEditor] = useState<{
    settings: CareerSettings;
    openAfterSave: boolean;
    pinSaveId?: string;
  } | null>(null);
  const mounted = useRef(false);
  const version = useRef(0);
  async function task(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The operation failed.');
    } finally {
      setBusy('');
    }
  }
  const loadLibrary = async () => {
    const result = await api<{ careers: Career[]; selection: Selection | null }>('/careers');
    setCareers(result.careers);
    setPrevious(result.selection);
  };
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    void task('Looking for career saves…', async () => {
      await loadLibrary();
      try {
        await api('/saves/discover', { method: 'POST' });
      } finally {
        await loadLibrary();
      }
    });
  }, []);
  async function selectCareer(careerId: string, saveId?: string) {
    await task('Reading the selected career…', async () => {
      const targetId = saveId ?? careers.find((career) => career.id === careerId)?.latestSave.id;
      const settings = await api<CareerSettings>(
        `/careers/${careerId}/settings${targetId ? `?saveId=${targetId}` : ''}`,
      );
      if (settings.clubNameSource === 'UNRESOLVED') {
        setCareerEditor({ settings, openAfterSave: true, pinSaveId: saveId });
        return;
      }
      version.current++;
      setCareerEditor(null);
      setCurrent(null);
      setPlayer(null);
      setSavePicker(false);
      setFilters({ first: initialFilter(), youth: initialFilter() });
      setPage('overview');
      await api(`/careers/${careerId}/select`, {
        method: 'POST',
        body: JSON.stringify(saveId ? { saveId } : {}),
      });
      setCurrent(await api(`/careers/${careerId}/current`));
      await refreshContext(careerId);
    });
  }
  async function editCareer(careerId: string, saveId?: string) {
    await task('Loading career settings…', async () =>
      setCareerEditor({
        settings: await api<CareerSettings>(
          `/careers/${careerId}/settings${saveId ? `?saveId=${saveId}` : ''}`,
        ),
        openAfterSave: false,
      }),
    );
  }
  async function refreshContext(careerId: string) {
    const result = await api<Current>(`/careers/${careerId}/refresh`, { method: 'POST' });
    setCurrent(result);
    setPlayer(null);
    await loadLibrary();
  }
  async function refresh() {
    if (current)
      await task('Reading save, validating players and updating images…', () =>
        refreshContext(current.careerId),
      );
  }
  async function showSaves(id: string) {
    await task('Loading saves…', async () => {
      const result = await api<{ saves: SaveEntry[] }>(`/careers/${id}/saves`);
      setSaveList(result.saves);
      setExpanded(id);
    });
  }
  function navigate(next: Page) {
    setPlayer(null);
    setSavePicker(false);
    setPage(next);
    setError('');
  }
  const nav = [
    { id: 'library', label: t('Careers'), icon: Library },
    { id: 'overview', label: t('Overview'), icon: LayoutDashboard },
    { id: 'first', label: t('First team'), icon: Users },
    { id: 'youth', label: t('Youth academy'), icon: TrendingUp },
    { id: 'development', label: t('Development'), icon: Activity },
  ] as const;
  const data = current?.data;
  const title = player
    ? player.displayName
    : {
        library: t('Your career library'),
        overview: t('Career overview'),
        first: t('First team'),
        youth: t('Youth academy'),
        development: t('Player development'),
        settings: t('Settings'),
      }[page];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('library');
          }}
          aria-label={t('FC26 Career Lens home')}
        >
          <img className="brand-mark" src="/images/logo_fcl_hd.png" alt="" />
          <span>
            FC26<span className="brand-sub">CAREER LENS</span>
          </span>
        </a>
        <div className="workspace-label">{t('WORKSPACE')}</div>
        <nav aria-label={t('Main navigation')}>
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              disabled={!!busy || (item.id !== 'library' && !current)}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              {item.label}
              {item.id === 'first' && data && (
                <span className="nav-count">{data.integrity.firstTeamExpected}</span>
              )}
              {item.id === 'youth' && data && (
                <span className="nav-count">
                  {data.players.filter((player) => player.squadType === 'YOUTH').length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <ShieldCheck size={19} />
            <div>
              {t('Made for your career')}
              <small>{t('Local. Private. Read-only.')}</small>
            </div>
          </div>
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            disabled={!!busy}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={19} />
            {t('Settings')}{' '}
          </button>
          <div className="version">
            <span className="status-dot" />
            {t('LOCAL WORKSPACE')} <span>v0.1</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            {t('Workspace')} <ChevronRight size={14} />
            <span>
              {page === 'library'
                ? t('Careers')
                : (current?.save.metadata.clubName ?? t('Settings'))}
            </span>
          </div>
          <div className="topbar-status">
            <span className="status-dot" /> {t('Offline ready')} <span className="divider" />
            <HardDrive size={15} /> {t('On this device')}{' '}
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">{t('EA SPORTS FC 26 / MANAGER CAREER')}</div>
              <h1>{title}</h1>
              <p>
                {page === 'library'
                  ? t('Every save. One place to understand your squad.')
                  : page === 'settings'
                    ? t('Connect your local files and keep your workspace ready.')
                    : player
                      ? t('A closer look at the selected player record.')
                      : t('A clear view of your squad, your prospects and what comes next.')}
              </p>
            </div>
            <div className="heading-actions">
              {page === 'library' ? (
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={() =>
                    void task('Scanning all Manager Career saves…', async () => {
                      const result = await api<{ files: number }>('/saves/discover', {
                        method: 'POST',
                      });
                      await loadLibrary();
                      setNotice(
                        t('Library updated. {count} saves found.', { count: result.files }),
                      );
                    })
                  }
                >
                  <RefreshCw size={16} />
                  {t('Scan for saves')}{' '}
                </button>
              ) : current && page !== 'settings' ? (
                <>
                  <button className="button" disabled={!!busy} onClick={() => void refresh()}>
                    <RefreshCw size={16} />
                    {t('Refresh save')}{' '}
                  </button>
                  <button
                    className="button primary"
                    disabled={!!busy || !current.snapshotId}
                    onClick={() =>
                      void task('Preparing your Excel workbook…', async () => {
                        const response = await fetch(
                          `/api/careers/${current.careerId}/export/xlsx?snapshotId=${current.snapshotId}`,
                        );
                        if (!response.ok) {
                          const body = await response.json();
                          throw new Error(body.error.message);
                        }
                        const blob = await response.blob();
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download =
                          response.headers
                            .get('Content-Disposition')
                            ?.match(/filename="(.+)"/)?.[1] ?? 'career.xlsx';
                        link.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      })
                    }
                  >
                    <Download size={16} />
                    {t('Export Excel')}{' '}
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {busy && (
            <div className="banner loading" role="status">
              <RefreshCw size={17} className="spin" />
              {message(busy)}
            </div>
          )}
          {error && (
            <div className="banner error" role="alert">
              <AlertTriangle size={18} />
              <span>{message(error)}</span>
              <button aria-label={t('Dismiss error')} onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="banner success" role="status">
              <Check size={17} />
              {message(notice)}
            </div>
          )}
          {page === 'library' && (
            <>
              <div className="library-stats">
                <div>
                  <span className="stat-icon">
                    <FolderOpen size={21} />
                  </span>
                  <div>
                    <strong>{careers.length.toString().padStart(2, '0')}</strong>
                    <span>{t('Career entries')}</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon">
                    <Database size={21} />
                  </span>
                  <div>
                    <strong>
                      {careers
                        .reduce((sum, c) => sum + c.saveCount, 0)
                        .toString()
                        .padStart(2, '0')}
                    </strong>
                    <span>{t('Available saves')}</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon">
                    <ShieldCheck size={21} />
                  </span>
                  <div>
                    <strong className="text-stat">{t('Read-only')}</strong>
                    <span>{t('Your original saves stay intact')}</span>
                  </div>
                </div>
              </div>
              <div className="section-heading">
                <div>
                  <h2>
                    {t('Choose a career')} <span className="count">{careers.length}</span>
                  </h2>
                  <p>{t('Select a career to explore its first team and academy.')}</p>
                </div>
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label={t('Search careers')}
                    placeholder={t('Search club or save…')}
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                  />
                </label>
              </div>
              {previous && careers.some((career) => career.id === previous.careerId) && (
                <div className="previous-selection">
                  <Clock3 size={16} />
                  <span>{t('Previous selection is saved. Choose a career to continue.')}</span>
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      void selectCareer(
                        previous.careerId,
                        previous.mode === 'PINNED_SAVE' ? previous.saveId : undefined,
                      )
                    }
                  >
                    {t('Continue')} <ArrowRight size={14} />
                  </button>
                </div>
              )}
              {!careers.length ? (
                <div className="panel">
                  <Empty icon={<FolderOpen size={34} />} title={t('Your next chapter starts here')}>
                    <p>{t('Scan your FC26 settings folder to find Manager Career saves.')}</p>
                    <p>{t('No saves yet? Set your save folder in Settings.')}</p>
                    <button
                      className="button"
                      disabled={!!busy}
                      onClick={() => navigate('settings')}
                    >
                      <Settings2 size={16} />
                      {t('Open settings')}{' '}
                    </button>
                  </Empty>
                </div>
              ) : (
                <div className="career-grid">
                  {careers
                    .filter((c) =>
                      `${c.clubName} ${c.latestSave.fileName}`
                        .toLowerCase()
                        .includes(librarySearch.toLowerCase()),
                    )
                    .map((career, index) => (
                      <article className="career-card" key={career.id}>
                        <div className="career-card-top">
                          <span className="club-emblem">
                            {career.clubName === 'Unidentified club' ? (
                              <ShieldCheck size={26} />
                            ) : (
                              initials(career.clubName)
                            )}
                          </span>
                          <Badge
                            tone={
                              career.identityStatus === 'CONFIRMED'
                                ? 'green'
                                : career.identityStatus === 'ERROR'
                                  ? 'amber'
                                  : 'neutral'
                            }
                          >
                            {career.identityStatus === 'CONFIRMED'
                              ? t('Verified career')
                              : career.identityStatus === 'ERROR'
                                ? t('Metadata error')
                                : t('Identity unconfirmed')}
                          </Badge>
                        </div>
                        <div className="career-number">
                          {t('CAREER ENTRY')} {String(index + 1).padStart(2, '0')}
                        </div>
                        <h3>{career.clubName}</h3>
                        {career.latestSave.metadata.clubNameSource === 'UNRESOLVED' && (
                          <p className="inline-warning">
                            {t('Club name required before opening this career.')}{' '}
                          </p>
                        )}
                        <div className="career-id">
                          {career.id.slice(0, 22)}…{' '}
                          <span>
                            · {career.saveCount} {career.saveCount === 1 ? 'save' : 'saves'}
                          </span>
                        </div>
                        <div className="save-preview">
                          <div className="caption">{t('LATEST AVAILABLE SAVE')}</div>
                          <div className="file-name" title={career.latestSave.fileName}>
                            {career.latestSave.fileName}
                          </div>
                          <div className="save-meta">
                            <Clock3 size={13} />
                            {date(career.latestSave.modifiedAt)}
                            <span>· {number(career.latestSave.size / 1024 / 1024, 1)} MB</span>
                          </div>
                        </div>
                        {career.latestSave.error && (
                          <p className="inline-warning">{message(career.latestSave.error)}</p>
                        )}
                        {career.latestSave.missing && (
                          <p className="inline-warning">
                            {t('Save file is missing. Snapshots are preserved.')}{' '}
                          </p>
                        )}
                        <div className="card-actions">
                          <button
                            className="button use-career"
                            disabled={
                              !!busy || career.latestSave.missing || !!career.latestSave.error
                            }
                            onClick={() => void selectCareer(career.id)}
                          >
                            {career.latestSave.metadata.clubNameSource === 'UNRESOLVED'
                              ? t('Name club & open')
                              : t('Use career')}{' '}
                            <ArrowRight size={16} />
                          </button>
                          <button
                            className="icon-button"
                            disabled={!!busy}
                            aria-label={t('View saves for {club}', { club: career.clubName })}
                            onClick={() => {
                              if (expanded === career.id) setExpanded(null);
                              else void showSaves(career.id);
                            }}
                          >
                            <ChevronDown size={18} />
                          </button>
                        </div>
                        <button
                          className="text-button career-edit"
                          disabled={!!busy || career.latestSave.metadata.clubId == null}
                          onClick={() => void editCareer(career.id)}
                        >
                          {t('Career settings')}{' '}
                        </button>
                        {expanded === career.id && (
                          <SaveChoices
                            saves={saveList}
                            disabled={!!busy}
                            onSelect={(id) => void selectCareer(career.id, id)}
                          />
                        )}
                      </article>
                    ))}
                </div>
              )}
              <div className="info-strip">
                <ShieldCheck size={19} />
                <p>
                  <strong>{t('Your save is the source of truth.')}</strong>{' '}
                  {t(
                    'Careers are grouped only when their identity is verified. Unconfirmed saves stay separate, even when they share a club.',
                  )}{' '}
                </p>
              </div>
            </>
          )}
          {current && page !== 'library' && page !== 'settings' && (
            <>
              <div className="context-bar">
                <button
                  className="button small"
                  disabled={!!busy}
                  onClick={() => void editCareer(current.careerId, current.save.id)}
                >
                  <Settings2 size={15} />
                  {t('Career settings')}{' '}
                </button>
                <span className="mini-emblem">{initials(current.save.metadata.clubName)}</span>
                <div className="context-club">
                  <strong>{current.save.metadata.clubName}</strong>
                  <span title={current.careerId}>
                    {t('Active career ·')} {current.careerId.slice(0, 24)}…
                  </span>
                </div>
                <div className="context-save">
                  <span>
                    {t('SELECTED SAVE ·')}{' '}
                    {current.mode === 'PINNED_SAVE' ? t('PINNED') : t('LATEST IN CAREER')}
                  </span>
                  <strong title={current.save.fileName}>{current.save.fileName}</strong>
                  <small>
                    {t('Modified')} {date(current.save.modifiedAt)} {t('· Ages as of')}{' '}
                    {current.data?.careerDateInfo?.referenceDate
                      ? formatBirthDate(current.data.careerDateInfo.referenceDate)
                      : t('Unavailable')}
                  </small>
                </div>
                <button
                  className="button small"
                  disabled={!!busy}
                  onClick={() => {
                    setSavePicker(!savePicker);
                    if (!savePicker) void showSaves(current.careerId);
                  }}
                >
                  {t('Choose another save')} <ChevronDown size={14} />
                </button>
                <button
                  className="icon-button"
                  title={t('Switch career')}
                  aria-label={t('Switch career')}
                  disabled={!!busy}
                  onClick={() => navigate('library')}
                >
                  <FolderOpen size={19} />
                </button>
              </div>
              {savePicker && (
                <div className="panel save-picker">
                  <h3>{t('Choose a save')}</h3>
                  <p>
                    {t('Latest available:')}{' '}
                    {current.latestSave?.fileName ?? t('No available file')}
                  </p>
                  <button
                    className="button small"
                    disabled={!!busy}
                    onClick={() => void selectCareer(current.careerId)}
                  >
                    {t('Follow latest in this career')}{' '}
                  </button>
                  <SaveChoices
                    saves={saveList}
                    disabled={!!busy}
                    onSelect={(id) => void selectCareer(current.careerId, id)}
                  />
                </div>
              )}
              {(current.save.changed || current.save.missing) && (
                <div className="banner warning">
                  <AlertTriangle size={18} />
                  {current.save.missing
                    ? t('The selected file is missing. Choose another save explicitly.')
                    : t(
                        'This file has not been imported or differs from the last imported snapshot. Refresh to analyze it.',
                      )}
                </div>
              )}
              {data && (
                <IntegrityPanel
                  data={data}
                  disabled={!!busy}
                  onResolve={(issue, recordKey) => {
                    if (!current?.snapshotId || issue.playerId == null || !issue.squadType) return;
                    const body = {
                      snapshotId: current.snapshotId,
                      playerId: issue.playerId,
                      squadType: issue.squadType,
                      recordKey,
                    };
                    void task('Saving player record selection…', async () => {
                      setCurrent(
                        await api(`/careers/${current.careerId}/player-record`, {
                          method: 'PUT',
                          body: JSON.stringify(body),
                        }),
                      );
                      setPlayer(null);
                      setNotice(
                        recordKey
                          ? 'Player record selected for this snapshot.'
                          : 'Player record selection undone.',
                      );
                    });
                  }}
                />
              )}
              {current.imageWarnings.map((warning, index) => (
                <div className="banner warning" key={index}>
                  <AlertTriangle size={17} />
                  {message(warning)}
                </div>
              ))}
              {!data ? (
                <div className="panel">
                  <Empty icon={<Database size={34} />} title={t('Ready to analyze')}>
                    <p>
                      {t(
                        'Refresh this save to resolve players, check integrity and import minifaces.',
                      )}{' '}
                    </p>
                    <button
                      className="button primary"
                      disabled={!!busy}
                      onClick={() => void refresh()}
                    >
                      <RefreshCw size={16} />
                      {t('Analyze selected save')}{' '}
                    </button>
                  </Empty>
                </div>
              ) : player ? (
                <PlayerDetail
                  key={`${current.snapshotId}:${player.internalKey}`}
                  player={player}
                  current={current}
                  disabled={!!busy}
                  onBack={() => setPlayer(null)}
                  onImage={async (file) => {
                    await task('Updating player portrait…', async () => {
                      const path = `/careers/${current.careerId}/players/${player.internalKey}/image?snapshotId=${current.snapshotId}`;
                      if (file) {
                        const form = new FormData();
                        form.append('image', file);
                        await api(path, { method: 'POST', body: form });
                      } else await api(path, { method: 'DELETE' });
                      const next = await api<Current>(`/careers/${current.careerId}/current`);
                      setCurrent(next);
                      setPlayer(
                        next.data?.players.find((p) => p.internalKey === player.internalKey) ??
                          null,
                      );
                    });
                  }}
                />
              ) : page === 'overview' ? (
                <Overview current={current} onNavigate={navigate} onPlayer={setPlayer} />
              ) : page === 'first' || page === 'youth' ? (
                <SquadTable
                  squad={page === 'first' ? 'FIRST_TEAM' : 'YOUTH'}
                  players={data.players}
                  filter={filters[page]}
                  onFilter={(filter) => setFilters({ ...filters, [page]: filter })}
                  onPlayer={setPlayer}
                />
              ) : page === 'development' ? (
                <Development current={current} />
              ) : null}
            </>
          )}
          {page === 'settings' && (
            <>
              {current && (
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() => void editCareer(current.careerId, current.save.id)}
                >
                  {t('Career settings —')} {current.save.metadata.clubName}
                </button>
              )}
              <SettingsPage disabled={!!busy} task={task} />
            </>
          )}
          {careerEditor && (
            <CareerSettingsForm
              key={`${careerEditor.settings.careerId}:${careerEditor.settings.saveId}`}
              settings={careerEditor.settings}
              error={message(error)}
              disabled={!!busy}
              openAfterSave={careerEditor.openAfterSave}
              onClose={() => setCareerEditor(null)}
              onSave={async (values) => {
                let saved = false;
                await task('Saving career settings…', async () => {
                  await api(`/careers/${careerEditor.settings.careerId}/settings`, {
                    method: 'PUT',
                    body: JSON.stringify(values),
                  });
                  await loadLibrary();
                  if (current?.careerId === careerEditor.settings.careerId) {
                    setCurrent(await api(`/careers/${current.careerId}/current`));
                    setPlayer(null);
                  }
                  saved = true;
                  setCareerEditor(null);
                  setNotice('Career settings saved.');
                });
                if (saved && careerEditor.openAfterSave)
                  await selectCareer(careerEditor.settings.careerId, careerEditor.pinSaveId);
              }}
            />
          )}
          <footer>
            <span>FC26 CAREER LENS</span>
            <span>
              {t('Built for the long game.')} <span className="footer-dot">·</span>{' '}
              {t('All data stays on this device.')}{' '}
            </span>
            <span>{t('Unofficial fan project')}</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function SaveChoices({
  saves,
  disabled,
  onSelect,
}: {
  saves: SaveEntry[];
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const { t, date, message } = useI18n();
  return (
    <ul className="save-choices">
      {saves
        .filter((save) => !save.missing)
        .map((save) => (
          <li key={save.id}>
            <button
              disabled={disabled || save.missing || !!save.error}
              onClick={() => onSelect(save.id)}
            >
              <span>
                <strong>{save.fileName}</strong>
                <small>
                  {save.metadata.clubName} · {date(save.modifiedAt)}
                  {save.missing ? t(' · Missing') : ''}
                </small>
              </span>
              <ArrowRight size={16} />
            </button>
            {save.error && <small className="inline-warning">{message(save.error)}</small>}
          </li>
        ))}
    </ul>
  );
}
function IntegrityPanel({
  data,
  disabled,
  onResolve,
}: {
  data: ParsedSave;
  disabled: boolean;
  onResolve: (issue: Issue, recordKey: string | null) => void;
}) {
  const { t, formatBirthDate, message } = useI18n();
  const i = data.integrity;
  const problem =
    i.ambiguousCount > 0 ||
    i.unresolvedCount > 0 ||
    i.firstTeamExpected !== i.firstTeamResolved ||
    i.youthExpected !== i.youthResolved;
  return (
    <details className={`integrity ${problem ? 'has-issues' : ''}`}>
      <summary>
        <span>
          {problem ? <AlertTriangle size={17} /> : <ShieldCheck size={17} />}
          <strong>
            {problem ? t('Some player records need attention') : t('Player integrity checked')}
          </strong>
        </span>
        <span>
          {t('First team')} {i.firstTeamResolved}/{i.firstTeamExpected} {t('· Academy')}{' '}
          {i.youthResolved}/{i.youthExpected} <ChevronDown size={15} />
        </span>
      </summary>
      <div className="integrity-body">
        <p>
          {i.ambiguousCount} {t('ambiguous ·')} {i.unresolvedCount}{' '}
          {t(
            'unresolved. Counts are resolved / expected. Ambiguous players are retained here and excluded from attributed player statistics.',
          )}{' '}
        </p>
        {data.issues.map((issue, index) => (
          <div className="issue" key={index}>
            <strong>{issue.code}</strong>
            <p>{message(issue.message)}</p>
            {issue.code === 'PLAYER_RECORD_AMBIGUOUS' && (
              <p>
                {issue.candidates?.some((c) => c.player)
                  ? t(
                      'Recognize your player? Select the matching record below. This choice applies only to this snapshot and does not modify your game save.',
                    )
                  : t(
                      'Refresh save to load selectable records. If no options appear, the squad membership also needs verification.',
                    )}
              </p>
            )}
            {issue.candidates?.map((candidate) => (
              <div key={candidate.recordKey} className="candidate">
                <span>
                  {candidate.displayName} {t('· OVR')} {value(candidate.overall)} {t('· Born')}{' '}
                  {formatBirthDate(candidate.birthDate)}
                </span>
                {candidate.player &&
                  ['PLAYER_RECORD_AMBIGUOUS', 'PLAYER_RECORD_USER_SELECTED'].includes(
                    issue.code,
                  ) && (
                    <button
                      className="button secondary small"
                      disabled={disabled || issue.selectedRecordKey === candidate.recordKey}
                      onClick={() => onResolve(issue, candidate.recordKey)}
                    >
                      {issue.selectedRecordKey === candidate.recordKey
                        ? t('Selected: {player}', { player: candidate.displayName })
                        : t('Use {player}', { player: candidate.displayName })}
                    </button>
                  )}
              </div>
            ))}
            {issue.selectedRecordKey && (
              <button
                className="button secondary small"
                disabled={disabled}
                onClick={() => onResolve(issue, null)}
              >
                {t('Undo selection')}{' '}
              </button>
            )}
          </div>
        ))}
        {data.metadata.warnings.map((w) => (
          <p key={message(w)}>{message(w)}</p>
        ))}
      </div>
    </details>
  );
}
function Overview({
  current,
  onNavigate,
  onPlayer,
}: {
  current: Current;
  onNavigate: (page: Page) => void;
  onPlayer: (p: CareerPlayer) => void;
}) {
  const { t, date, position, formatBirthDate } = useI18n();
  const data = current.data!;
  const players = data.players;
  const high = (field: 'overall' | 'potential') =>
    players.length ? Math.max(...players.map((p) => p[field] ?? 0)) || 'N/A' : 'N/A';
  const prospects = sortPlayers(
    players.filter((p) => p.squadType === 'YOUTH'),
    'potential',
    'desc',
  ).slice(0, 5);
  return (
    <>
      <div className="metrics">
        <Metric
          label={t('FIRST TEAM')}
          amount={data.integrity.firstTeamResolved}
          detail={t('of {count} linked players resolved', {
            count: data.integrity.firstTeamExpected,
          })}
          icon={<Users size={20} />}
        />
        <Metric
          label={t('YOUTH ACADEMY')}
          amount={data.integrity.youthResolved}
          detail={t('of {count} prospects resolved', { count: data.integrity.youthExpected })}
          icon={<TrendingUp size={20} />}
        />
        <Metric
          label={t('HIGHEST OVERALL')}
          amount={high('overall')}
          detail={t('Across resolved player records')}
          icon={<Activity size={20} />}
        />
        <Metric
          label={t('HIGHEST POTENTIAL')}
          amount={high('potential')}
          detail={t('Across resolved player records')}
          icon={<TrendingUp size={20} />}
          accent
        />
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{t('THE NEXT GENERATION')}</span>
              <h2>{t('Academy watch')}</h2>
            </div>
            <button className="text-button" onClick={() => onNavigate('youth')}>
              {t('View academy')} <ArrowRight size={15} />
            </button>
          </div>
          {prospects.length ? (
            <div className="watch-list">
              {prospects.map((p) => (
                <button key={p.internalKey} onClick={() => onPlayer(p)}>
                  <Avatar player={p} />
                  <span className="watch-name">
                    <strong>{p.displayName}</strong>
                    <small>
                      {p.primaryPosition ? position(p.primaryPosition) : 'N/A'} ·{' '}
                      {p.age == null ? t('Age —') : t('{count} years', { count: p.age })}
                    </small>
                  </span>
                  <span className="watch-rating">
                    <small>{t('OVR')}</small>
                    {value(p.overall)}
                  </span>
                  <span className="watch-rating green-text">
                    <small>{t('POT')}</small>
                    {value(p.potential)}
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          ) : (
            <Empty icon={<Users size={28} />} title={t('No resolved prospects')}>
              <p>{t('Academy records will appear after a successful import.')}</p>
            </Empty>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{t('YOUR CURRENT CONTEXT')}</span>
              <h2>{t('Snapshot details')}</h2>
            </div>
            <Database size={20} />
          </div>
          <dl className="detail-list">
            <dt>{t('Imported')}</dt>
            <dd>{date(current.createdAt)}</dd>
            <dt>{t('Last match')}</dt>
            <dd>{formatBirthDate(data.careerDateInfo?.lastMatchDate)}</dd>
            <dt>{t('Next match')}</dt>
            <dd>
              {data.careerDateInfo?.nextMatchDate
                ? formatBirthDate(data.careerDateInfo.nextMatchDate)
                : t('Unavailable')}
            </dd>
            <dt>{t('Age reference date')}</dt>
            <dd>
              {data.careerDateInfo?.referenceDate
                ? formatBirthDate(data.careerDateInfo.referenceDate)
                : t('Unavailable')}
            </dd>
            <dt>{t('Date source')}</dt>
            <dd>
              {data.careerDateInfo?.referenceDateSource === 'SAVE_LAST_MATCH'
                ? t('Last match in save')
                : data.careerDateInfo?.referenceDateSource === 'MATCH_HISTORY'
                  ? t('Played match history')
                  : t('Unavailable')}
            </dd>
            <dt>{t('Latest available')}</dt>
            <dd className="wrap">{current.latestSave?.fileName ?? 'N/A'}</dd>
            <dt>{t('Career identity')}</dt>
            <dd>
              {data.metadata.identityStatus === 'CONFIRMED'
                ? t('Confirmed')
                : t('Unconfirmed · separate save')}
            </dd>
            <dt>{t('Snapshot')}</dt>
            <dd className="mono wrap">{current.snapshotId}</dd>
          </dl>
          <div className="panel-note">
            <ShieldCheck size={18} />
            <p>
              {t(
                'Ages refer to the last completed match, which may differ from the current day in your career. Only this career and selected save are included in your workbook.',
              )}{' '}
            </p>
          </div>
        </section>
      </div>
      <section className="panel position-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{t('SQUAD COMPOSITION')}</span>
            <h2>{t('Coverage by position')}</h2>
          </div>
          <Badge>{t('First team · resolved players')}</Badge>
        </div>
        <div className="position-chart">
          {POSITION_ORDER.map((pos) => {
            const count = players.filter(
              (p) => p.squadType === 'FIRST_TEAM' && p.primaryPosition === pos,
            ).length;
            return (
              <div key={pos}>
                <strong>{count}</strong>
                <div className="bar-track">
                  <div style={{ height: `${Math.min(count * 16, 100)}%` }} />
                </div>
                <span>{position(pos)}</span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
function Metric({
  label,
  amount,
  detail,
  icon,
  accent = false,
}: {
  label: string;
  amount: ReactNode;
  detail: string;
  icon: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="metric">
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong className={accent ? 'green-text' : ''}>{amount}</strong>
      <small>{detail}</small>
    </div>
  );
}

function SquadTable({
  squad,
  players,
  filter,
  onFilter,
  onPlayer,
}: {
  squad: SquadType;
  players: CareerPlayer[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  onPlayer: (p: CareerPlayer) => void;
}) {
  const { t, money, position, formatBirthDate } = useI18n();
  const [advanced, setAdvanced] = useState(false);
  const update = (key: keyof Filter, input: string | boolean) =>
    onFilter({ ...filter, [key]: input });
  const visible = sortPlayers(
    players.filter((p) => {
      if (
        p.squadType !== squad ||
        !p.displayName.toLowerCase().includes(filter.search.toLowerCase()) ||
        (filter.position && p.primaryPosition !== filter.position)
      )
        return false;
      for (const [field, min, max] of [
        ['age', 'ageMin', 'ageMax'],
        ['overall', 'ovrMin', 'ovrMax'],
        ['potential', 'potMin', 'potMax'],
      ] as const) {
        const n = p[field];
        if (filter[min] !== '' && (n == null || n < Number(filter[min]))) return false;
        if (filter[max] !== '' && (n == null || n > Number(filter[max]))) return false;
      }
      return true;
    }),
    filter.sort,
    filter.direction,
  );
  const columns: { field: SortField; label: string }[] = [
    { field: 'displayName', label: t('Player') },
    { field: 'age', label: t('Age') },
    { field: 'birthDate', label: t('Date of birth') },
    { field: 'primaryPosition', label: t('Position') },
    { field: 'secondaryPositions', label: t('Secondary') },
    { field: 'overall', label: t('OVR') },
    { field: 'potential', label: t('POT') },
    ...(squad === 'YOUTH' ? [{ field: 'growthMargin' as const, label: t('Growth') }] : []),
    ...(squad === 'FIRST_TEAM'
      ? [{ field: 'contractEndYear' as const, label: t('Contract') }]
      : []),
    { field: 'weeklyWage', label: t('Weekly wage') },
  ];
  function sort(field: SortField) {
    onFilter({
      ...filter,
      sort: field,
      direction:
        filter.sort !== field
          ? 'asc'
          : filter.direction === 'asc'
            ? 'desc'
            : filter.direction === 'desc'
              ? 'none'
              : 'asc',
    });
  }
  return (
    <section className="panel squad-panel">
      <div className="squad-toolbar">
        <label className="search">
          <Search size={17} />
          <input
            aria-label={t('Search players')}
            placeholder={t('Search players…')}
            value={filter.search}
            onChange={(e) => update('search', e.target.value)}
          />
        </label>
        <select
          aria-label={t('Filter by position')}
          value={filter.position}
          onChange={(e) => update('position', e.target.value)}
        >
          <option value="">{t('All positions')}</option>
          {POSITION_ORDER.map((p) => (
            <option key={p} value={p}>
              {position(p)}
            </option>
          ))}
        </select>
        <button
          className={`button ${advanced ? 'selected' : ''}`}
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
        >
          <SlidersHorizontal size={15} />
          {t('Filters')}{' '}
        </button>
        <span className="toolbar-spacer" />
        <span className="muted">
          {visible.length} {t('players')}
        </span>
        {squad === 'YOUTH' && (
          <div className="view-toggle">
            <button
              aria-label={t('Table view')}
              aria-pressed={!filter.cards}
              className={!filter.cards ? 'selected' : ''}
              onClick={() => update('cards', false)}
            >
              <List size={17} />
            </button>
            <button
              aria-label={t('Card view')}
              aria-pressed={filter.cards}
              className={filter.cards ? 'selected' : ''}
              onClick={() => update('cards', true)}
            >
              <Grid2X2 size={17} />
            </button>
          </div>
        )}
      </div>
      {advanced && (
        <div className="advanced-filters">
          {[
            [t('Age'), 'ageMin', 'ageMax'],
            [t('OVR'), 'ovrMin', 'ovrMax'],
            [t('POT'), 'potMin', 'potMax'],
          ].map(([label, min, max]) => (
            <fieldset key={label}>
              <legend>{label}</legend>
              <input
                type="number"
                aria-label={t('Minimum {label}', { label })}
                min="0"
                max="100"
                placeholder={t('Min')}
                value={filter[min as keyof Filter] as string}
                onChange={(e) => update(min as keyof Filter, e.target.value)}
              />
              <span>–</span>
              <input
                type="number"
                aria-label={t('Maximum {label}', { label })}
                min="0"
                max="100"
                placeholder={t('Max')}
                value={filter[max as keyof Filter] as string}
                onChange={(e) => update(max as keyof Filter, e.target.value)}
              />
            </fieldset>
          ))}
          <button className="text-button" onClick={() => onFilter(initialFilter())}>
            {t('Reset filters')}{' '}
          </button>
        </div>
      )}
      {filter.cards && squad === 'YOUTH' ? (
        <>
          <div className="card-sort">
            <label>
              {t('Sort by')}{' '}
              <select
                value={filter.sort}
                onChange={(e) => onFilter({ ...filter, sort: e.target.value as SortField })}
              >
                {columns.map((c) => (
                  <option value={c.field} key={c.field}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="button small" onClick={() => sort(filter.sort)}>
              {t(
                filter.direction === 'asc'
                  ? 'Ascending'
                  : filter.direction === 'desc'
                    ? 'Descending'
                    : 'Default order',
              )}{' '}
              <ArrowUpDown size={14} />
            </button>
          </div>
          <div className="prospect-grid">
            {visible.map((p) => (
              <button className="prospect-card" key={p.internalKey} onClick={() => onPlayer(p)}>
                <Avatar player={p} large />
                <h3>{p.displayName}</h3>
                <p>
                  {p.primaryPosition ? position(p.primaryPosition) : 'N/A'} {t('· Age')}{' '}
                  {p.age ?? '—'} {t('· Born')} {formatBirthDate(p.birthDate)}
                </p>
                <div>
                  <span>
                    <small>{t('OVR')}</small>
                    <strong>{value(p.overall)}</strong>
                  </span>
                  <span>
                    <small>{t('POT')}</small>
                    <strong className="green-text">{value(p.potential)}</strong>
                  </span>
                  <span>
                    <small>{t('GROWTH')}</small>
                    <strong>
                      {p.growthMargin == null
                        ? 'N/A'
                        : `${p.growthMargin >= 0 ? '+' : ''}${p.growthMargin}`}
                    </strong>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="photo-heading">{t('Photo')}</th>
                {columns.map((c) => (
                  <th
                    key={c.field}
                    aria-sort={
                      filter.sort === c.field && filter.direction !== 'none'
                        ? filter.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button onClick={() => sort(c.field)}>
                      {c.label}
                      {filter.sort === c.field && filter.direction !== 'none' ? (
                        filter.direction === 'asc' ? (
                          <ArrowUp size={13} />
                        ) : (
                          <ArrowDown size={13} />
                        )
                      ) : (
                        <ArrowUpDown size={13} />
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.internalKey} onClick={() => onPlayer(p)}>
                  <td>
                    <Avatar player={p} />
                  </td>
                  <td>
                    <button
                      className="player-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayer(p);
                      }}
                    >
                      {p.displayName}
                    </button>
                    <small className="player-nationality">
                      {p.nationality ?? t('Player ID {id}', { id: p.playerId })}
                    </small>
                  </td>
                  <td>{p.age ?? '—'}</td>
                  <td>{formatBirthDate(p.birthDate)}</td>
                  <td>
                    <Badge>{p.primaryPosition ? position(p.primaryPosition) : 'N/A'}</Badge>
                  </td>
                  <td>{p.secondaryPositions.map((pos) => position(pos)).join(' / ') || '—'}</td>
                  <td>
                    <strong className="rating-number">{value(p.overall)}</strong>
                  </td>
                  <td>
                    <strong className="rating-number green-text">{value(p.potential)}</strong>
                  </td>
                  {squad === 'YOUTH' && (
                    <td className="green-text">
                      {p.growthMargin == null
                        ? 'N/A'
                        : `${p.growthMargin >= 0 ? '+' : ''}${p.growthMargin}`}
                    </td>
                  )}
                  {squad === 'FIRST_TEAM' && <td>{value(p.contractEndYear)}</td>}
                  <td>{money(p.weeklyWage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!visible.length && (
        <Empty icon={<Search size={28} />} title={t('No matching players')}>
          <p>{t('Adjust your filters or review unresolved records above.')}</p>
        </Empty>
      )}
      <div className="table-footer">
        <span>
          {t('Showing')} {visible.length} {t('resolved players')}
        </span>
        <span>
          {t(
            "Age is as of the last completed match, not today's career calendar. — / N/A means unavailable.",
          )}{' '}
        </span>
      </div>
    </section>
  );
}

function PlayerDetail({
  player,
  current,
  disabled,
  onBack,
  onImage,
}: {
  player: CareerPlayer;
  current: Current;
  disabled: boolean;
  onBack: () => void;
  onImage: (file: File | null) => Promise<void>;
}) {
  const { t, date, money, position, formatBirthDate, attribute, message } = useI18n();
  const [history, setHistory] = useState<{ created_at: string; data: CareerPlayer }[]>([]);
  const [historyError, setHistoryError] = useState('');
  useEffect(() => {
    let active = true;
    void api<{ history: { created_at: string; data: CareerPlayer }[] }>(
      `/careers/${current.careerId}/players/${player.internalKey}?snapshotId=${current.snapshotId}`,
    )
      .then((r) => {
        if (active) setHistory(r.history);
      })
      .catch((e) => {
        if (active) setHistoryError(String(e));
      });
    return () => {
      active = false;
    };
  }, [current.careerId, current.snapshotId, player.internalKey]);
  return (
    <>
      <button className="text-button back" onClick={onBack}>
        <ArrowLeft size={16} />
        {t('Back to squad')}{' '}
      </button>
      <div className="player-profile panel">
        <Avatar player={player} large />
        <div>
          <Badge>{player.squadType === 'YOUTH' ? t('Youth academy') : t('First team')}</Badge>
          <h2>{player.displayName}</h2>
          <p>
            {player.primaryPosition ? position(player.primaryPosition) : t('Position N/A')} ·{' '}
            {player.nationality ?? t('Nationality N/A')} {t('· Age')} {player.age ?? '—'}
          </p>
          <small>
            {t('Player ID')} {player.playerId} ·{' '}
            {player.image?.source === 'MANUAL'
              ? t('Manual portrait')
              : player.image
                ? t('Local miniface')
                : t('No portrait available')}
          </small>
        </div>
        <div className="profile-ratings">
          <span>
            <small>{t('OVERALL')}</small>
            <strong>{value(player.overall)}</strong>
          </span>
          <span>
            <small>{t('POTENTIAL')}</small>
            <strong className="green-text">{value(player.potential)}</strong>
          </span>
        </div>
      </div>
      <div className="profile-actions">
        <label className={`button ${disabled ? 'disabled' : ''}`}>
          <Upload size={16} />
          {t('Change portrait')}{' '}
          <input
            type="file"
            className="file-input"
            aria-label={t('Upload player portrait')}
            accept=".dds,.png,.jpg,.jpeg,.webp"
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImage(file);
              e.target.value = '';
            }}
          />
        </label>
        {player.image?.source === 'MANUAL' && (
          <button className="button" disabled={disabled} onClick={() => void onImage(null)}>
            {t('Remove manual portrait')}{' '}
          </button>
        )}
        <span className="muted">{t('DDS, PNG, JPG or WEBP · up to 10 MB')}</span>
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>{t('Player details')}</h2>
          </div>
          <dl className="detail-list">
            <dt>{t('Date of birth')}</dt>
            <dd>{formatBirthDate(player.birthDate)}</dd>
            <dt>{t('Age reference (last match)')}</dt>
            <dd>{formatBirthDate(current.data?.careerDateInfo?.referenceDate)}</dd>
            <dt>{t('Secondary positions')}</dt>
            <dd>{player.secondaryPositions.map((p) => position(p)).join(', ') || 'N/A'}</dd>
            <dt>{t('Growth margin')}</dt>
            <dd>{value(player.growthMargin)}</dd>
            <dt>
              {player.squadType === 'YOUTH' ? t('Academy agreement') : t('Contract end year')}
            </dt>
            <dd>{value(player.contractEndYear)}</dd>
            <dt>{t('Weekly wage (game units)')}</dt>
            <dd>{money(player.weeklyWage)}</dd>
            <dt>{t('Appearances / minutes')}</dt>
            <dd>
              {value(player.appearances)} / {value(player.minutes)}
            </dd>
            <dt>{t('Average rating')}</dt>
            <dd>{value(player.averageRating)}</dd>
          </dl>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>{t('Recorded development')}</h2>
          </div>
          {historyError && <p className="inline-warning">{message(historyError)}</p>}
          <div className="history-list">
            {history.map((entry, i) => (
              <div key={i}>
                <Clock3 size={16} />
                <span>{date(entry.created_at)}</span>
                <strong>
                  {t('OVR')} {value(entry.data.overall)}
                </strong>
                <strong className="green-text">
                  {t('POT')} {value(entry.data.potential)}
                </strong>
              </div>
            ))}
          </div>
          <p className="panel-description">
            {t(
              'History is scoped to this career and verified player record. Unconfirmed save identities are kept separate across changed file contents.',
            )}{' '}
          </p>
        </section>
      </div>
      {Object.keys(player.attributes ?? {}).length > 0 && (
        <section className="panel">
          <div className="panel-heading">
            <h2>{t('Player attributes')}</h2>
          </div>
          <dl className="attribute-grid">
            {Object.entries(player.attributes ?? {}).map(([name, rating]) => (
              <div key={name}>
                <dt>{attribute(name)}</dt>
                <dd>{value(rating)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}
function Development({ current }: { current: Current }) {
  const { t, date, message } = useI18n();
  const [snapshots, setSnapshots] = useState<
    { id: string; save_id: string; hash: string; created_at: string }[]
  >([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api<{ snapshots: typeof snapshots }>(`/careers/${current.careerId}/history`)
      .then((r) => {
        if (active) setSnapshots(r.snapshots);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [current.careerId, current.snapshotId]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{t('CAREER ARCHIVE')}</span>
          <h2>{t('Snapshot history')}</h2>
        </div>
        <Badge>
          {snapshots.length} {t('snapshots')}
        </Badge>
      </div>
      <p className="panel-description">
        {t(
          'Each import preserves the state of the selected save. Open a player to view recorded ratings. Cross-save comparisons require confirmed career and player identities.',
        )}{' '}
      </p>
      {error && <p className="inline-warning">{message(error)}</p>}
      <div className="history-list">
        {snapshots.map((s, i) => (
          <div key={s.id}>
            <span className="timeline-number">{String(snapshots.length - i).padStart(2, '0')}</span>
            <span>
              <strong>{date(s.created_at)}</strong>
              <small className="mono">{s.id}</small>
            </span>
            <Badge tone={s.id === current.snapshotId ? 'green' : 'neutral'}>
              {s.id === current.snapshotId ? t('Selected') : t('Archived')}
            </Badge>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsPage(props: {
  disabled: boolean;
  task: (label: string, fn: () => Promise<void>) => Promise<void>;
}) {
  const { t, locale, setLocale } = useI18n();
  return (
    <>
      <section className="panel language-panel" aria-labelledby="language-title">
        <div className="panel-heading">
          <h2 id="language-title">{t('Language')}</h2>
        </div>
        <div className="settings-fields">
          <label>
            {t('Interface language')}
            <select
              value={locale}
              onChange={(event) => {
                if (isLocale(event.target.value)) setLocale(event.target.value);
              }}
              aria-describedby="language-hint"
            >
              {languages.map((language) => (
                <option key={language.value} value={language.value} lang={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
            <small id="language-hint">{t('Applied immediately and saved on this browser.')}</small>
          </label>
        </div>
      </section>
      <SettingsFiles {...props} />
    </>
  );
}

function SettingsFiles({
  disabled,
  task,
}: {
  disabled: boolean;
  task: (label: string, fn: () => Promise<void>) => Promise<void>;
}) {
  const { t, message } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [localError, setLocalError] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all([api<{ settings: Settings }>('/settings'), api<Diagnostics>('/diagnostics')])
      .then(([s, d]) => {
        if (active) {
          setSettings(s.settings);
          setDiagnostics(d);
        }
      })
      .catch((e) => {
        if (active) setLocalError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  if (localError)
    return (
      <div className="banner error" role="alert">
        {message(localError)}
      </div>
    );
  if (!settings)
    return (
      <div className="banner loading" role="status">
        {t('Loading local configuration…')}{' '}
      </div>
    );
  const fields = [
    {
      key: 'saveDirectory',
      label: t('Manager Career saves'),
      hint: t('The folder containing your CmMgr files. All matching files are inventoried.'),
    },
    {
      key: 'headDirectory',
      label: t('First-team minifaces'),
      hint: t('Local Live Editor heads folder. Originals are copied and preserved.'),
    },
    {
      key: 'youthHeadDirectory',
      label: t('Academy minifaces'),
      hint: t('Local Live Editor youthheads folder.'),
    },
    {
      key: 'gameDirectory',
      label: t('FC26 installation'),
      hint: t('Optional if detected automatically. Used to generate your local names database.'),
    },
  ] as const;
  return (
    <div className="settings-grid">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{t('FILE SOURCES')}</span>
            <h2>{t('Local folders')}</h2>
          </div>
          <FolderOpen size={21} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void task('Validating and saving settings…', async () => {
              const result = await api<{ settings: Settings }>('/settings', {
                method: 'PUT',
                body: JSON.stringify(settings),
              });
              setSettings(result.settings);
              setDiagnostics(await api('/diagnostics'));
            });
          }}
        >
          <div className="settings-fields">
            {fields.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  value={settings[field.key]}
                  disabled={disabled}
                  onChange={(e) => setSettings({ ...settings, [field.key]: e.target.value })}
                  placeholder={field.key === 'gameDirectory' ? t('Auto-detect installation') : ''}
                />
                <small>{field.hint}</small>
              </label>
            ))}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.autoImages}
                disabled={disabled}
                onChange={(e) => setSettings({ ...settings, autoImages: e.target.checked })}
              />
              <span>
                {t('Look for minifaces when refreshing a save')}{' '}
                <small>{t('Manual portraits take priority until removed.')}</small>
              </span>
            </label>
          </div>
          <div className="settings-submit">
            <button className="button primary" disabled={disabled} type="submit">
              <Check size={16} />
              {t('Save settings')}{' '}
            </button>
          </div>
        </form>
      </section>
      <div>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{t('ENVIRONMENT')}</span>
              <h2>{t('System check')}</h2>
            </div>
            <Activity size={20} />
          </div>
          <div className="diagnostic-list">
            {diagnostics &&
              Object.entries(diagnostics).map(([key, state]) => (
                <div key={key}>
                  <span>
                    {
                      (
                        {
                          node: 'Node.js',
                          python: 'Python',
                          pillow: t('Image converter'),
                          parser: t('FC26 decoder'),
                          globalNames: t('Global names'),
                          saveDirectory: t('Save folder'),
                          headDirectory: t('First-team images'),
                          youthHeadDirectory: t('Academy images'),
                        } as Record<string, string>
                      )[key]
                    }
                  </span>
                  <Badge tone={state ? 'green' : 'amber'}>
                    {typeof state === 'string' ? state : state ? t('Ready') : t('Missing')}
                  </Badge>
                </div>
              ))}
          </div>
        </section>
        <section className="panel names-panel">
          <Database size={23} />
          <h2>{t('Player names database')}</h2>
          <p>
            {t(
              'Resolve name IDs using files from your installed copy of FC26. Extraction runs locally and may take several minutes.',
            )}{' '}
          </p>
          <p>
            {t(
              'Save your installation path above before generating. Refresh a save afterward to resolve its names.',
            )}{' '}
          </p>
          <button
            className="button"
            disabled={disabled}
            onClick={() =>
              void task(
                'Extracting the local names database. This may take several minutes…',
                async () => {
                  await api('/names/generate', { method: 'POST' });
                  setDiagnostics(await api('/diagnostics'));
                },
              )
            }
          >
            <Database size={16} />
            {t('Generate names database')}{' '}
          </button>
        </section>
      </div>
    </div>
  );
}
