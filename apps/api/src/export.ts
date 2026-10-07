import ExcelJS from 'exceljs';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './config.js';
import { Images } from './images.js';
import { Store, type SnapshotRow } from './store.js';
import {
  POSITION_LABELS,
  isValidDate,
  formatBirthDate,
} from '../../../packages/shared/src/domain.js';
import { internalDirectory, checkOutputFile } from './paths.js';
export async function exportWorkbook(store: Store, images: Images, snapshot: SnapshotRow) {
  const data = store.parsed(snapshot);
  const save = store.save(snapshot.save_id)!;
  const book = new ExcelJS.Workbook();
  book.creator = 'FC26 Career Analyzer';
  book.created = new Date();
  const summary = book.addWorksheet('Summary');
  summary.columns = [
    { header: 'Field', key: 'field', width: 30 },
    { header: 'Value', key: 'value', width: 80 },
  ];
  const values: Record<string, string | number | null> = {
    Club: data.metadata.clubName,
    'Career ID': snapshot.career_id,
    'Selected save': data.source?.fileName ?? save.file_name,
    'Save SHA-256': snapshot.hash,
    'File modified': data.source?.modifiedAt ?? save.mtime,
    'Last match': formatBirthDate(data.careerDateInfo?.lastMatchDate),
    'Next match': formatBirthDate(data.careerDateInfo?.nextMatchDate),
    'Age reference date': formatBirthDate(data.careerDateInfo?.referenceDate),
    'Age reference source': data.careerDateInfo?.referenceDateSource ?? 'UNAVAILABLE',
    'Age basis': 'Last completed match; not necessarily the current career day.',
    'Club name source': data.metadata.clubNameSource ?? 'SAVE',
    'Snapshot created': snapshot.created_at,
    'Identity status': data.metadata.identityStatus,
    ...data.integrity,
    'Highest OVR': Math.max(...data.players.map((p) => p.overall ?? 0), 0) || null,
    'Highest POT': Math.max(...data.players.map((p) => p.potential ?? 0), 0) || null,
  };
  for (const [field, value] of Object.entries(values)) summary.addRow({ field, value });
  for (const issue of data.issues) summary.addRow({ field: issue.code, value: issue.message });
  for (const warning of data.metadata.warnings) summary.addRow({ field: 'Notice', value: warning });
  for (const [type, name] of [
    ['FIRST_TEAM', 'First Team'],
    ['YOUTH', 'Youth Academy'],
  ] as const) {
    const sheet = book.addWorksheet(name);
    const attributes = [
      ...new Set(
        data.players
          .filter((p) => p.squadType === type)
          .flatMap((p) => Object.keys(p.attributes ?? {})),
      ),
    ].sort();
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns = [
      { header: 'Photo', key: 'photo', width: 12 },
      { header: 'Player', key: 'displayName', width: 30 },
      { header: 'Player ID', key: 'playerId', width: 14 },
      { header: 'Record key', key: 'internalKey', width: 35 },
      { header: 'Age', key: 'age', width: 8 },
      { header: 'Date of birth', key: 'birthDate', width: 14 },
      { header: 'Position', key: 'position', width: 10 },
      { header: 'Secondary', key: 'secondary', width: 18 },
      ...(['overall', 'potential', 'growthMargin', 'weeklyWage'] as const).map((key, index) => ({
        header: ['OVR', 'POT', 'Growth', 'Weekly wage'][index],
        key,
        width: 16,
      })),
      ...(type === 'FIRST_TEAM'
        ? [{ header: 'Contract year', key: 'contractEndYear', width: 16 }]
        : []),
      ...attributes.map((key) => ({
        header: key.replaceAll('_', ' '),
        key: `attribute:${key}`,
        width: 18,
      })),
    ];
    for (const player of data.players.filter((p) => p.squadType === type)) {
      const row = sheet.addRow({
        ...player,
        age: player.age ?? '—',
        birthDate: isValidDate(player.birthDate) ? new Date(`${player.birthDate}T00:00:00Z`) : '—',
        ...Object.fromEntries(
          attributes.map((key) => [`attribute:${key}`, player.attributes?.[key] ?? null]),
        ),
        position: player.primaryPosition ? POSITION_LABELS[player.primaryPosition] : null,
        secondary: player.secondaryPositions.map((p) => POSITION_LABELS[p]).join(', '),
      });
      row.height = 48;
      if (player.image) {
        const bytes = await readFile(
          await images.file(snapshot.career_id, player.internalKey, 'png'),
        );
        const imageId = book.addImage({ base64: bytes.toString('base64'), extension: 'png' });
        sheet.addImage(imageId, {
          tl: { col: 0, row: row.number - 1 },
          ext: { width: 56, height: 56 },
        });
      }
    }
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount },
    };
    sheet.getColumn('weeklyWage').numFmt = '#,##0.00';
    sheet.getColumn('birthDate').numFmt = 'dd/mm/yyyy';
  }
  for (const sheet of book.worksheets) {
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
    sheet.getRow(1).height = 26;
  }
  const club = data.metadata.clubName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'Career';
  const filename = `${club}_${snapshot.career_id.slice(-8)}_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  await internalDirectory(join(ROOT, 'exports'));
  const output = join(ROOT, 'exports', filename);
  await checkOutputFile(output);
  await writeFile(output, bytes);
  return { filename, bytes };
}
