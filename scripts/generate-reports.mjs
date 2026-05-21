import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const dataPath = path.join(root, 'public/data/editing-records.json')
const reportsPath = path.join(root, 'public/data/reports.json')
const reportsDir = path.join(root, 'public/reports')

function getChinaDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return `${year}-${month}-${day}`
}

function parseDate(date) {
  return new Date(`${date}T12:00:00+08:00`)
}

function getWeekStart(date) {
  const parsed = parseDate(date)
  const day = parsed.getDay() || 7
  parsed.setDate(parsed.getDate() - day + 1)
  return getChinaDateString(parsed)
}

function getWeekEnd(date) {
  const parsed = parseDate(getWeekStart(date))
  parsed.setDate(parsed.getDate() + 6)
  return getChinaDateString(parsed)
}

function getMonthKey(date) {
  return date.slice(0, 7)
}

function getTotals(records) {
  const editCount = records.reduce((sum, record) => sum + record.editCount, 0)
  const complexCount = records.reduce((sum, record) => sum + record.complexCount, 0)
  return {
    editCount,
    complexCount,
    ratio: editCount > 0 ? Math.round((complexCount / editCount) * 100) : 0,
  }
}

function createReport(type, today, records) {
  const weekly = type === 'weekly'
  const periodStart = weekly ? getWeekStart(today) : `${getMonthKey(today)}-01`
  const periodEnd = weekly ? getWeekEnd(today) : today
  const period = weekly ? `${periodStart} 至 ${periodEnd}` : getMonthKey(today)
  const scopedRecords = records.filter((record) =>
    weekly
      ? record.date >= periodStart && record.date <= periodEnd
      : getMonthKey(record.date) === getMonthKey(today),
  )
  const totals = getTotals(scopedRecords)
  const title = weekly ? `周总结 ${period}` : `月总结 ${period}`
  const fileName = `${weekly ? 'weekly' : 'monthly'}-${weekly ? periodStart : getMonthKey(today)}.md`
  const reportPath = `reports/${fileName}`
  const bestDay = [...scopedRecords].sort((a, b) => b.editCount - a.editCount)[0]
  const body = [
    `# ${title}`,
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    `- 剪辑总数：${totals.editCount}`,
    `- 复杂片数量：${totals.complexCount}`,
    `- 复杂片占比：${totals.ratio}%`,
    `- 记录天数：${scopedRecords.length}`,
    bestDay ? `- 最高产出日：${bestDay.date}，剪辑 ${bestDay.editCount} 个` : '- 最高产出日：暂无',
    '',
    '## 明细',
    '',
    '| 日期 | 剪辑数量 | 复杂片数量 | 备注 |',
    '| --- | ---: | ---: | --- |',
    ...scopedRecords
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((record) => `| ${record.date} | ${record.editCount} | ${record.complexCount} | ${record.note || '-'} |`),
    '',
  ].join('\n')

  fs.mkdirSync(reportsDir, { recursive: true })
  fs.writeFileSync(path.join(reportsDir, fileName), body, 'utf8')

  return {
    type,
    title,
    period,
    editCount: totals.editCount,
    complexCount: totals.complexCount,
    ratio: totals.ratio,
    generatedAt: new Date().toISOString(),
    path: reportPath,
  }
}

const mode = process.argv.includes('--monthly') ? 'monthly' : 'weekly'
const today = getChinaDateString(new Date())
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
const records = data.records ?? []
const existing = fs.existsSync(reportsPath)
  ? JSON.parse(fs.readFileSync(reportsPath, 'utf8')).reports ?? []
  : []
const nextReport = createReport(mode, today, records)
const reports = [
  nextReport,
  ...existing.filter((report) => report.path !== nextReport.path),
].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))

fs.writeFileSync(reportsPath, `${JSON.stringify({ reports }, null, 2)}\n`, 'utf8')
console.log(`Generated ${nextReport.title}`)
