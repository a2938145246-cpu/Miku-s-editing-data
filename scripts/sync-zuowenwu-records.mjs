import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const DOC_URL = 'https://docs.qq.com/sheet/DQk5VTGhIdlJORlJo';
const TARGET_EDITOR = '左文武';
const TARGET_SHEET = '剪辑端填写8月(新)';
const DATA_PATH = path.resolve('public/data/editing-records.json');
const EDGE_PATH =
  process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const EDGE_USER_DATA_DIR =
  process.env.EDGE_USER_DATA_DIR ?? 'C:/Users/Administrator/AppData/Local/Microsoft/Edge/User Data';
const EDGE_PROFILE = process.env.EDGE_PROFILE ?? 'Default';
const DEBUG_PORT = Number(process.env.EDGE_DEBUG_PORT ?? '9222');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`请求失败: ${url} -> ${response.status}`);
  }
  return response.json();
}

async function ensureDebugBrowser() {
  try {
    const version = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    return { started: false, version };
  } catch {
    // Fall through and start Edge with the persisted profile.
  }

  spawn(
    EDGE_PATH,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${EDGE_USER_DATA_DIR}`,
      `--profile-directory=${EDGE_PROFILE}`,
      DOC_URL,
    ],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    },
  ).unref();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      return { started: true, version };
    } catch {
      await sleep(1_000);
    }
  }

  throw new Error('无法启动带调试端口的 Edge。');
}

function cellText(cell) {
  if (!cell) return null;
  if (cell.formattedValue?.value != null) {
    return String(cell.formattedValue.value);
  }
  if (typeof cell.value === 'string' || typeof cell.value === 'number') {
    return String(cell.value);
  }
  if (cell.value?.r) {
    return cell.value.r.map((part) => part.t ?? '').join('');
  }
  return null;
}

function normalizeTitle(text) {
  return text
    .replace(/[#＃]/g, '')
    .replace(/[\u00a0\u2002-\u200b\u202f\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\\/]+$/g, '')
    .trim();
}

function splitImplicitTitles(segment) {
  const normalized = normalizeTitle(segment);
  if (!normalized) return [];

  const marker = /[\u4e00-\u9fff]{2,4}-/g;
  const starts = [];
  let match;
  while ((match = marker.exec(normalized)) !== null) {
    starts.push(match.index);
  }

  if (starts.length <= 1 || starts[0] !== 0) {
    return [normalized];
  }

  const parts = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = index + 1 < starts.length ? starts[index + 1] : normalized.length;
    const part = normalizeTitle(normalized.slice(start, end));
    if (part) parts.push(part);
  }
  return parts;
}

function expandRepeatedTitle(title) {
  const match = title.match(/^(.*?)[×xX*]\s*(\d+)$/);
  if (!match) return [title];
  const base = normalizeTitle(match[1]);
  const count = Number(match[2]);
  if (!base || !Number.isFinite(count) || count < 2) return [title];
  return Array.from({ length: count }, () => base);
}

function extractTitles(...texts) {
  return texts
    .flatMap((text) => String(text ?? '').split(/[\r\n/]+/))
    .flatMap((segment) => splitImplicitTitles(segment))
    .flatMap((segment) => expandRepeatedTitle(segment))
    .map((title) => normalizeTitle(title))
    .filter(Boolean);
}

function toIsoDate(sourceDate) {
  const match = String(sourceDate).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) {
    throw new Error(`无法解析日期: ${sourceDate}`);
  }
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function joinNote(videoNames) {
  return videoNames.join('/');
}

function buildCounts(items) {
  const counts = new Map();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return counts;
}

function diffCount(nextItems, previousItems) {
  const prevCounts = buildCounts(previousItems);
  let added = 0;
  for (const item of nextItems) {
    const remaining = prevCounts.get(item) ?? 0;
    if (remaining > 0) {
      prevCounts.set(item, remaining - 1);
    } else {
      added += 1;
    }
  }
  return added;
}

function sortByDateDesc(records) {
  return [...records].sort((left, right) => right.date.localeCompare(left.date));
}

async function loadSourceRows() {
  await ensureDebugBrowser();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  try {
    const page =
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().includes('docs.qq.com/sheet')) ??
      (await browser.contexts()[0].newPage());

    await page.goto(DOC_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});

    const payload = await page.evaluate(({ targetEditor, targetSheet }) => {
      const workbook = window.SpreadsheetApp?.workbook;
      if (!workbook) {
        throw new Error('SpreadsheetApp.workbook 不存在');
      }

      const sheet = workbook.worksheetManager.sheetList.find(
        (candidate) => candidate._AnT === targetSheet || candidate.sheetProperties?.codeName === targetSheet,
      );
      if (!sheet) {
        throw new Error(`未找到目标子表: ${targetSheet}`);
      }

      const grid = sheet.cellDataGrid;
      const rows = [];
      for (let rowIndex = 3; rowIndex <= grid.usedRange.endRowIndex; rowIndex += 1) {
        const editor = grid.getCellData(rowIndex, 0)?.value ?? null;
        if (editor !== targetEditor) continue;

        rows.push({
          rowIndex,
          date: grid.getCellData(rowIndex, 1)?.formattedValue?.value ?? null,
          editCount: grid.getCellData(rowIndex, 2)?.formattedValue?.value ?? null,
          c3: grid.getCellData(rowIndex, 3),
          c4: grid.getCellData(rowIndex, 4),
          c5: grid.getCellData(rowIndex, 5),
          c6: grid.getCellData(rowIndex, 6),
        });
      }

      return rows.map((row) => ({
        rowIndex: row.rowIndex,
        date: row.date,
        editCount: row.editCount,
        c3: row.c3,
        c4: row.c4,
        c5: row.c5,
        c6: row.c6,
      }));
    }, { targetEditor: TARGET_EDITOR, targetSheet: TARGET_SHEET });

    return payload.map((row) => ({
      rowIndex: row.rowIndex,
      date: toIsoDate(row.date),
      sourceEditCount: Number(row.editCount) || 0,
      videoNames: extractTitles(
        cellText(row.c3),
        cellText(row.c4),
        cellText(row.c5),
        cellText(row.c6),
      ),
      complexVideoNames: extractTitles(cellText(row.c4)),
    }));
  } finally {
    await browser.close();
  }
}

function aggregateSourceRows(rows) {
  const grouped = new Map();
  const mismatches = [];

  for (const row of rows) {
    const current = grouped.get(row.date) ?? {
      date: row.date,
      sourceEditCount: 0,
      videoNames: [],
      complexVideoNames: [],
    };
    current.sourceEditCount += row.sourceEditCount;
    current.videoNames.push(...row.videoNames);
    current.complexVideoNames.push(...row.complexVideoNames);
    grouped.set(row.date, current);
  }

  for (const record of grouped.values()) {
    if (record.sourceEditCount !== record.videoNames.length) {
      mismatches.push({
        date: record.date,
        sourceEditCount: record.sourceEditCount,
        parsedCount: record.videoNames.length,
      });
    }
    record.editCount = record.videoNames.length;
    record.complexCount = record.complexVideoNames.length;
    record.note = joinNote(record.videoNames);
    record.editor = TARGET_EDITOR;
  }

  return { grouped, mismatches };
}

async function main() {
  const now = new Date().toISOString();
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  const data = JSON.parse(raw);
  const sourceRows = await loadSourceRows();
  const { grouped: sourceByDate, mismatches } = aggregateSourceRows(sourceRows);

  const existingByDate = new Map(data.records.map((record) => [record.date, record]));
  const changedDates = [];

  for (const [date, sourceRecord] of sourceByDate.entries()) {
    const previous = existingByDate.get(date);
    const createdAt = previous?.createdAt ?? now;
    const nextCore = {
      date,
      editCount: sourceRecord.editCount,
      complexCount: sourceRecord.complexCount,
      note: sourceRecord.note,
      videoNames: sourceRecord.videoNames,
      complexVideoNames: sourceRecord.complexVideoNames,
      editor: TARGET_EDITOR,
      createdAt,
    };
    const nextRecord = {
      ...nextCore,
      updatedAt: now,
    };

    const previousVideoNames = previous?.videoNames ?? [];
    const previousComplexNames = previous?.complexVideoNames ?? [];
    const addedCount = previous
      ? diffCount(nextRecord.videoNames, previousVideoNames)
      : nextRecord.videoNames.length;
    const addedComplexCount = previous
      ? diffCount(nextRecord.complexVideoNames, previousComplexNames)
      : nextRecord.complexVideoNames.length;

    const previousCore = previous
      ? {
          date: previous.date,
          editCount: previous.editCount,
          complexCount: previous.complexCount,
          note: previous.note,
          videoNames: previous.videoNames,
          complexVideoNames: previous.complexVideoNames,
          editor: previous.editor,
          createdAt: previous.createdAt,
        }
      : null;
    const changed = !previous || JSON.stringify(previousCore) !== JSON.stringify(nextCore);

    if (changed) {
      existingByDate.set(date, nextRecord);
      changedDates.push({
        date,
        addedCount,
        addedComplexCount,
        totalCount: nextRecord.editCount,
        totalComplexCount: nextRecord.complexCount,
      });
    }
  }

  const nextRecords = sortByDateDesc([...existingByDate.values()]);

  for (const record of nextRecords) {
    if (record.editCount !== record.videoNames.length) {
      throw new Error(`${record.date} 的 editCount 与 videoNames 数量不一致`);
    }
    if (record.complexCount !== record.complexVideoNames.length) {
      throw new Error(`${record.date} 的 complexCount 与 complexVideoNames 数量不一致`);
    }
  }

  const nextData = {
    ...data,
    records: nextRecords,
  };

  JSON.parse(JSON.stringify(nextData));
  await fs.writeFile(DATA_PATH, `${JSON.stringify(nextData, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        changedDates: changedDates.sort((left, right) => left.date.localeCompare(right.date)),
        latestSourceDate: [...sourceByDate.keys()].sort().at(-1) ?? null,
        totalSourceDates: sourceByDate.size,
        sourceCountMismatches: mismatches,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
