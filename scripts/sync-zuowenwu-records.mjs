import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const DOC_URL = 'https://docs.qq.com/sheet/DQk5VTGhIdlJORlJo';
const TARGET_EDITOR = '左文武';
const TARGET_SHEET_NAME = '剪辑端填写8月(新)';
const TARGET_SHEET_ID = 'ho459s';
const DATA_PATH = path.resolve('public/data/editing-records.json');
const REVIEW_DAYS = Number(process.env.ZUOWENWU_REVIEW_DAYS ?? '7');

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
  return String(text ?? '')
    .replace(/[#＃]/g, '')
    .replace(/[\\]+\s*-/g, '-')
    .replace(/[\\]+/g, '/')
    .replace(/[，、；;]/g, '/')
    .replace(/[\u00a0\u2002-\u200b\u202f\u3000\u2005\u2006\u2007\u2008\u2009]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\\/]+$/g, '')
    .trim();
}

function splitImplicitTitles(segment) {
  const normalized = normalizeTitle(segment);
  if (!normalized) return [];

  const commonSurnames = new Set(
    '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封储靳焦牧山蔡田胡易艾文龙白邓谭彭邝农岑涂钟'
  );
  const starts = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const marker = normalized[index];
    if (marker !== '-' && marker !== '·') continue;

    let selectedStart = null;
    for (const length of [2, 3, 4]) {
      const start = index - length;
      if (start < 0) continue;
      const name = normalized.slice(start, index);
      if (!/^[\u4e00-\u9fff]{2,4}$/.test(name)) continue;
      if (!commonSurnames.has(name[0])) continue;
      selectedStart = start;
      break;
    }

    if (selectedStart != null) {
      starts.push(selectedStart);
    }
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
  const match = title.match(/^(.*?)[×xX*]\s*(\d+)\s*(?:条)?$/);
  if (!match) return [title];
  const base = normalizeTitle(match[1]);
  const count = Number(match[2]);
  if (!base || !Number.isFinite(count) || count < 2) return [title];
  return Array.from({ length: count }, () => base);
}

function extractTitles(...texts) {
  return texts
    .flatMap((text) => String(text ?? '').split(/[\r\n/]+/))
    .flatMap((segment) => segment.split(/\s{2,}/))
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

function uniqueItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
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

function shiftIsoDate(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function buildSyncWindow(existingRecords, sourceDates) {
  if (existingRecords.length === 0 || sourceDates.length === 0) {
    return {
      mode: 'full',
      startDate: sourceDates[0] ?? null,
      endDate: sourceDates.at(-1) ?? null,
    };
  }

  const latestExistingDate = existingRecords[0].date;
  const latestSourceDate = sourceDates.at(-1);
  const startDate = shiftIsoDate(latestExistingDate, -REVIEW_DAYS);

  return {
    mode: 'incremental',
    startDate,
    endDate: latestSourceDate,
    latestExistingDate,
  };
}

async function waitForWorkbook(page) {
  await page.waitForFunction(() => Boolean(window.SpreadsheetApp?.workbook), undefined, {
    timeout: 60_000,
  });
}

async function hydrateTargetSheet(page, targetSheetId) {
  let stableRounds = 0;
  let previousEndRow = -1;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const endRow = await page.evaluate((sheetId) => {
      const sheet = window.SpreadsheetApp?.workbook?.worksheetManager?.sheetList?.find(
        (candidate) => candidate.cellDataGrid?.usedRange?.sheetId === sheetId,
      );
      return sheet?.cellDataGrid?.usedRange?.endRowIndex ?? -1;
    }, targetSheetId);

    if (endRow === previousEndRow) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
      previousEndRow = endRow;
    }

    if (stableRounds >= 2 && endRow >= 400) {
      break;
    }

    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(1_500);
  }
}

async function resolveTargetSheetId(page) {
  await page.goto(DOC_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForWorkbook(page);
  await page.waitForTimeout(8_000);

  const meta = await page.evaluate((targetSheetName) => {
    const sheets = window.spreadConfig?._EJ?.collab_client_vars?.header?.[0]?.d ?? [];
    return {
      currentSheetId: window.spreadConfig?._EJ?.collab_client_vars?.padSubId ?? null,
      sheets: sheets.map((sheet) => ({
        id: sheet.id,
        name: sheet.name,
        hidden: Boolean(sheet.hidden),
      })),
      target:
        sheets.find((sheet) => sheet.name === targetSheetName) ??
        sheets.find((sheet) => String(sheet.name ?? '').includes('剪辑端')) ??
        null,
    };
  }, TARGET_SHEET_NAME);

  if (meta.target?.id) {
    return meta.target.id;
  }

  return TARGET_SHEET_ID;
}

async function loadSourceRows() {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    const targetSheetId = await resolveTargetSheetId(page);

    await page.goto(`${DOC_URL}?tab=${targetSheetId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await waitForWorkbook(page);
    await page.waitForTimeout(10_000);
    await hydrateTargetSheet(page, targetSheetId);

    const payload = await page.evaluate(
      async ({ targetSheetId, targetEditor }) => {
        const workbook = window.SpreadsheetApp?.workbook;
        if (!workbook) {
          throw new Error('SpreadsheetApp.workbook 不存在');
        }

        let targetSheet =
          workbook.worksheetManager.sheetList.find((sheet) => sheet.sheetId === targetSheetId) ??
          workbook.worksheetManager.sheetList.find(
            (sheet) => sheet.cellDataGrid?.usedRange?.sheetId === targetSheetId,
          );

        if (!targetSheet) {
          throw new Error(`未找到目标工作表 ID: ${targetSheetId}`);
        }

        if (targetSheet.cellDataGrid?.usedRange?.endRowIndex < 0) {
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          targetSheet =
            workbook.worksheetManager.sheetList.find((sheet) => sheet.sheetId === targetSheetId) ??
            targetSheet;
        }

        const grid = targetSheet.cellDataGrid;
        if (!grid || grid.usedRange.endRowIndex < 0) {
          throw new Error('目标工作表未加载出有效数据');
        }

        const rows = [];
        for (let rowIndex = 3; rowIndex <= grid.usedRange.endRowIndex; rowIndex += 1) {
          const editor = grid.getCellData(rowIndex, 0)?.formattedValue?.value ?? grid.getCellData(rowIndex, 0)?.value;
          if (editor !== targetEditor) continue;

          rows.push({
            rowIndex,
            date: grid.getCellData(rowIndex, 1),
            editCount: grid.getCellData(rowIndex, 2),
            c3: grid.getCellData(rowIndex, 3),
            c4: grid.getCellData(rowIndex, 4),
            c5: grid.getCellData(rowIndex, 5),
            c6: grid.getCellData(rowIndex, 6),
          });
        }

        return rows;
      },
      { targetSheetId, targetEditor: TARGET_EDITOR },
    );

    return payload.map((row) => ({
      rowIndex: row.rowIndex,
      date: toIsoDate(cellText(row.date)),
      sourceEditCount: Number(cellText(row.editCount)) || 0,
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
    record.videoNames = uniqueItems(record.videoNames);
    record.complexVideoNames = uniqueItems(record.complexVideoNames);
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
  const { grouped: allSourceByDate, mismatches } = aggregateSourceRows(sourceRows);
  const sourceDates = [...allSourceByDate.keys()].sort();
  const syncWindow = buildSyncWindow(data.records, sourceDates);
  const sourceByDate = new Map(
    [...allSourceByDate.entries()].filter(
      ([date]) =>
        (!syncWindow.startDate || date >= syncWindow.startDate) &&
        (!syncWindow.endDate || date <= syncWindow.endDate),
    ),
  );
  const processedMismatches = mismatches.filter(
    ({ date }) =>
      (!syncWindow.startDate || date >= syncWindow.startDate) &&
      (!syncWindow.endDate || date <= syncWindow.endDate),
  );

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
        latestSourceDate: sourceDates.at(-1) ?? null,
        totalSourceDates: allSourceByDate.size,
        processedSourceDates: sourceByDate.size,
        syncWindow,
        sourceCountMismatches: processedMismatches,
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
