import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type EditingRecord = {
  date: string
  editCount: number
  complexCount: number
  note: string
  videoNames?: string[]
  complexVideoNames?: string[]
  editor?: string
  createdAt: string
  updatedAt: string
}

type GitHubConfig = {
  owner: string
  repo: string
  branch: string
  token: string
}

type GitHubFile = {
  records: EditingRecord[]
  sha?: string
}

type ReportItem = {
  type: 'weekly' | 'monthly'
  title: string
  period: string
  editCount: number
  complexCount: number
  activeDays?: number
  averagePerActiveDay?: number
  ratio: number
  generatedAt: string
  path: string
}

const DATA_PATH = 'public/data/editing-records.json'
const DATA_URL = `${import.meta.env.BASE_URL}data/editing-records.json`
const REPORTS_URL = `${import.meta.env.BASE_URL}data/reports.json`
const CONFIG_KEY = 'editing-stats-github-config'
const emptyConfig: GitHubConfig = {
  owner: 'a2938145246-cpu',
  repo: 'Miku-s-editing-data',
  branch: 'main',
  token: '',
}

const defaultForm = {
  date: getChinaDateString(new Date()),
  editCount: '0',
  complexCount: '0',
  note: '',
}

function getChinaDateString(date: Date) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value ?? '2026'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'

  return `${year}-${month}-${day}`
}

function parseDate(date: string) {
  return new Date(`${date}T12:00:00+08:00`)
}

function getWeekStart(date: string) {
  const parsed = parseDate(date)
  const day = parsed.getDay() || 7
  parsed.setDate(parsed.getDate() - day + 1)
  return getChinaDateString(parsed)
}

function getMonthKey(date: string) {
  return date.slice(0, 7)
}

function getWeekEnd(date: string) {
  const parsed = parseDate(getWeekStart(date))
  parsed.setDate(parsed.getDate() + 6)
  return getChinaDateString(parsed)
}

function getTotals(records: EditingRecord[]) {
  const editCount = records.reduce((sum, record) => sum + record.editCount, 0)
  const complexCount = records.reduce(
    (sum, record) => sum + record.complexCount,
    0,
  )
  const activeDays = records.filter((record) => record.editCount > 0).length

  return {
    editCount,
    complexCount,
    activeDays,
    averagePerActiveDay:
      activeDays > 0 ? Math.round((editCount / activeDays) * 10) / 10 : 0,
    ratio: editCount > 0 ? Math.round((complexCount / editCount) * 100) : 0,
  }
}

function normalizeRecords(records: EditingRecord[]) {
  return [...records].sort((a, b) => b.date.localeCompare(a.date))
}

function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function decodeBase64Utf8(value: string) {
  const binary = atob(value.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function readSavedConfig() {
  const savedConfig = localStorage.getItem(CONFIG_KEY)
  if (!savedConfig) {
    return emptyConfig
  }

  try {
    return { ...emptyConfig, ...(JSON.parse(savedConfig) as GitHubConfig) }
  } catch {
    return emptyConfig
  }
}

function hasGitHubConfig(config: GitHubConfig) {
  return Boolean(
    config.owner.trim() &&
      config.repo.trim() &&
      config.branch.trim() &&
      config.token.trim(),
  )
}

async function fetchPublicRecords() {
  const response = await fetch(DATA_URL, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('没有读取到公开数据文件')
  }
  const payload = (await response.json()) as { records?: EditingRecord[] }
  return normalizeRecords(payload.records ?? [])
}

async function fetchReports() {
  const response = await fetch(REPORTS_URL, { cache: 'no-store' })
  if (!response.ok) {
    return []
  }
  const payload = (await response.json()) as { reports?: ReportItem[] }
  return payload.reports ?? []
}

function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (char === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(cell.trim())
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') {
        index += 1
      }
      row.push(cell.trim())
      if (row.some((value) => value.length > 0)) {
        rows.push(row)
      }
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  row.push(cell.trim())
  if (row.some((value) => value.length > 0)) {
    rows.push(row)
  }
  return rows
}

function excelSerialToDateString(serial: number) {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) {
    return ''
  }

  const utcTime = Math.round((serial - 25569) * 86400 * 1000)
  return getChinaDateString(new Date(utcTime))
}

function normalizeImportDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return getChinaDateString(value)
  }

  if (typeof value === 'number') {
    return excelSerialToDateString(value)
  }

  const text = String(value ?? '').trim()
  if (!text) {
    return ''
  }

  const serial = Number(text)
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serialDate = excelSerialToDateString(serial)
    if (serialDate) {
      return serialDate
    }
    if (/^\d{8}$/.test(text)) {
      return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
    }
  }

  const cleaned = text
    .replace(/[年月]/g, '-')
    .replace(/日/g, '')
    .replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, '')
  let match = cleaned.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (!match) {
    match = cleaned.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
    if (match) {
      const [, month, day, year] = match
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    }
  }
  if (!match) {
    match = cleaned.match(/^(\d{1,2})[-/.](\d{1,2})$/)
    if (match) {
      const [, month, day] = match
      const year = getChinaDateString(new Date()).slice(0, 4)
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    }
    return ''
  }

  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function findColumn(headers: string[], candidates: string[]) {
  const normalizedHeaders = headers.map((header) => header.trim().toLowerCase())
  return normalizedHeaders.findIndex((header) =>
    candidates.some((candidate) => header.includes(candidate.toLowerCase())),
  )
}

function parseImportedRecords(text: string) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''))
  return parseImportedRows(rows)
}

function findHeaderInfo(rows: unknown[][]) {
  for (let index = 0; index < Math.min(rows.length, 10); index += 1) {
    const headers = rows[index].map((header) => String(header ?? '').trim())
    const dateIndex = findColumn(headers, ['日期', '时间', '日子', 'date', 'day'])
    const editIndex = findColumn(headers, [
      '剪辑数量',
      '剪辑数',
      '剪辑',
      '完成数量',
      '数量',
      '条数',
      '完成条数',
      'edit',
      'count',
      'total',
    ])
    if (dateIndex >= 0 && editIndex >= 0) {
      return { hasHeader: true, headerRowIndex: index, headers, dateIndex, editIndex }
    }
  }

  return {
    hasHeader: false,
    headerRowIndex: -1,
    headers: [],
    dateIndex: 0,
    editIndex: 1,
  }
}

function toNumber(value: unknown) {
  if (typeof value === 'number') {
    return value
  }
  return Number(String(value ?? '').replace(/[^\d.]/g, '') || 0)
}

function splitVideoNames(value: unknown) {
  return String(value ?? '')
    .split(/[/\n；;、]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function getVideoNameIndexes(
  row: unknown[],
  headerInfo: ReturnType<typeof findHeaderInfo>,
  complexIndex: number,
  noteIndex: number,
) {
  if (headerInfo.hasHeader) {
    const firstVideoIndex = Math.max(headerInfo.dateIndex, headerInfo.editIndex) + 1
    if (complexIndex < 0 && noteIndex < 0) {
      return row.map((_, index) => index).filter((index) => index >= firstVideoIndex)
    }

    const taggedIndexes = headerInfo.headers
      .map((header, index) => ({ header, index }))
      .filter(({ header }) => /视频|片名|片子|作品|名称|选题|内容/i.test(header))
      .map(({ index }) => index)

    if (taggedIndexes.length > 0) {
      return taggedIndexes
    }

    return row
      .map((_, index) => index)
      .filter(
        (index) =>
          index >= firstVideoIndex &&
          index !== complexIndex &&
          index !== noteIndex,
      )
  }

  return row.map((_, index) => index).filter((index) => index >= 3)
}

function getComplexVideoNameIndexes(
  row: unknown[],
  headerInfo: ReturnType<typeof findHeaderInfo>,
) {
  const firstVideoIndex = Math.max(headerInfo.dateIndex, headerInfo.editIndex) + 1
  const templateMiddleIndex = firstVideoIndex + 1
  return templateMiddleIndex < row.length ? [templateMiddleIndex] : []
}

function parseImportedRows(rows: unknown[][]) {
  if (rows.length === 0) {
    return []
  }

  const headerInfo = findHeaderInfo(rows)
  const { hasHeader, headers, dateIndex, editIndex } = headerInfo
  const complexIndex = findColumn(headers, ['复杂片数量', '复杂片', '复杂'])
  const noteIndex = findColumn(headers, ['备注', '说明', '内容', 'note'])
  const editorIndex = findColumn(headers, ['剪辑人员', '剪辑师', '人员', 'editor'])
  const dataRows = hasHeader ? rows.slice(headerInfo.headerRowIndex + 1) : rows
  const now = new Date().toISOString()

  return dataRows
    .map((row): EditingRecord | null => {
      const date = normalizeImportDate(row[hasHeader ? dateIndex : 0])
      if (!date) {
        return null
      }
      const editCount = Math.max(0, toNumber(row[hasHeader ? editIndex : 1]))
      const complexCount = Math.max(
        0,
        toNumber(row[hasHeader && complexIndex >= 0 ? complexIndex : 2]),
      )
      const videoNameIndexes = getVideoNameIndexes(
        row,
        headerInfo,
        complexIndex,
        noteIndex,
      )
      const videoNames = videoNameIndexes.flatMap((index) =>
        splitVideoNames(row[index]),
      )
      const complexVideoNames =
        hasHeader && complexIndex < 0
          ? getComplexVideoNameIndexes(row, headerInfo).flatMap((index) =>
              splitVideoNames(row[index]),
            )
          : []
      const note = String(
        row[hasHeader && noteIndex >= 0 ? noteIndex : 3] ?? '',
      ).trim()

      return {
        date,
        editCount,
        complexCount:
          hasHeader && complexIndex < 0
            ? Math.min(complexVideoNames.length, editCount)
            : Math.min(complexCount, editCount),
        note,
        videoNames,
        complexVideoNames,
        editor: String(row[hasHeader && editorIndex >= 0 ? editorIndex : 0] ?? '').trim(),
        createdAt: now,
        updatedAt: now,
      }
    })
    .filter((record): record is EditingRecord => record !== null)
}

async function parseXlsxFile(file: File) {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const rawRows = XLSX.utils.sheet_to_json<Array<string | number | Date | null>>(
    firstSheet,
    {
      header: 1,
      raw: true,
      dateNF: 'yyyy-mm-dd',
      defval: '',
    },
  )
  return parseImportedRows(rawRows)
}

async function fetchRecordsFromGitHub(config: GitHubConfig): Promise<GitHubFile> {
  const response = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${DATA_PATH}?ref=${config.branch}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
      },
    },
  )

  if (!response.ok) {
    throw new Error('GitHub 数据文件读取失败，请检查令牌、仓库和分支')
  }

  const payload = (await response.json()) as { content: string; sha: string }
  const data = JSON.parse(decodeBase64Utf8(payload.content)) as {
    records?: EditingRecord[]
  }

  return {
    records: normalizeRecords(data.records ?? []),
    sha: payload.sha,
  }
}

async function saveRecordsToGitHub(
  config: GitHubConfig,
  records: EditingRecord[],
  sha?: string,
) {
  const content = `${JSON.stringify({ records: normalizeRecords(records) }, null, 2)}\n`
  const response = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${DATA_PATH}`,
    {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `更新剪辑数据 ${getChinaDateString(new Date())}`,
        content: encodeBase64Utf8(content),
        branch: config.branch,
        sha,
      }),
    },
  )

  if (!response.ok) {
    throw new Error('保存到 GitHub 失败，请确认令牌有内容写入权限')
  }

  const payload = (await response.json()) as { content: { sha: string } }
  return payload.content.sha
}

function createDownload(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function csvEscape(value: string | number) {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function App() {
  const [records, setRecords] = useState<EditingRecord[]>([])
  const [form, setForm] = useState(defaultForm)
  const [filters, setFilters] = useState({
    keyword: '',
    startDate: '',
    endDate: '',
    complexOnly: false,
  })
  const [config, setConfig] = useState<GitHubConfig>(readSavedConfig)
  const [fileSha, setFileSha] = useState<string>()
  const [reports, setReports] = useState<ReportItem[]>([])
  const [restorePoint, setRestorePoint] = useState<{
    label: string
    records: EditingRecord[]
  } | null>(null)
  const [deleteRange, setDeleteRange] = useState({
    startDate: '',
    endDate: '',
  })
  const [status, setStatus] = useState('正在读取公开数据...')
  const [isSaving, setIsSaving] = useState(false)
  const isGitHubReady = hasGitHubConfig(config)

  useEffect(() => {
    fetchPublicRecords()
      .then((loadedRecords) => {
        setRecords(loadedRecords)
        setStatus(`已读取 ${loadedRecords.length} 条记录`)
      })
      .catch((error: Error) => setStatus(error.message))
    fetchReports().then(setReports)
  }, [])

  useEffect(() => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  }, [config])

  const today = getChinaDateString(new Date())
  const todayRecord = records.find((record) => record.date === today)
  const currentWeek = getWeekStart(today)
  const currentMonth = getMonthKey(today)
  const currentYear = today.slice(0, 4)

  const weekRecords = records.filter(
    (record) => getWeekStart(record.date) === currentWeek,
  )
  const monthRecords = records.filter(
    (record) => getMonthKey(record.date) === currentMonth,
  )
  const yearRecords = records.filter((record) => record.date.startsWith(currentYear))

  const summary = [
    {
      label: '今日剪辑',
      value: todayRecord?.editCount ?? 0,
      sub: `复杂片 ${todayRecord?.complexCount ?? 0} 个`,
      tone: 'blue',
    },
    {
      label: '本周剪辑',
      value: getTotals(weekRecords).editCount,
      sub: `复杂片 ${getTotals(weekRecords).complexCount} 个`,
      tone: 'mint',
    },
    {
      label: '本月剪辑',
      value: getTotals(monthRecords).editCount,
      sub: `复杂片 ${getTotals(monthRecords).complexCount} 个`,
      tone: 'coral',
    },
    {
      label: '今年累计',
      value: getTotals(yearRecords).editCount,
      sub: `复杂片占比 ${getTotals(yearRecords).ratio}%`,
      tone: 'yellow',
    },
  ]

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const keywordMatched =
        filters.keyword.trim().length === 0 ||
        record.note.includes(filters.keyword.trim()) ||
        (record.editor ?? '').includes(filters.keyword.trim()) ||
        (record.videoNames ?? []).some((name) =>
          name.includes(filters.keyword.trim()),
        ) ||
        record.date.includes(filters.keyword.trim())
      const startMatched =
        filters.startDate.length === 0 || record.date >= filters.startDate
      const endMatched = filters.endDate.length === 0 || record.date <= filters.endDate
      const complexMatched = !filters.complexOnly || record.complexCount > 0
      return keywordMatched && startMatched && endMatched && complexMatched
    })
  }, [records, filters])

  const filteredTotals = getTotals(filteredRecords)
  const chartRecords = useMemo(
    () => [...records].sort((a, b) => a.date.localeCompare(b.date)).slice(-7),
    [records],
  )
  const chartMax = Math.max(
    1,
    ...chartRecords.map((record) =>
      Math.max(record.editCount, record.complexCount),
    ),
  )

  function requireGitHubConnection() {
    if (isGitHubReady) {
      return true
    }

    setStatus('请先在 GitHub 同步区域填好令牌。没有令牌的浏览器只能查看，不能保存或导入。')
    return false
  }

  function saveConfig() {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
    setStatus(
      isGitHubReady
        ? 'GitHub 设置已保存在当前浏览器，下次打开会自动带出来'
        : '已记住用户名、仓库名和分支；填入令牌后就可以保存数据',
    )
  }

  function clearConfig() {
    const nextConfig = { ...emptyConfig }
    setConfig(nextConfig)
    setFileSha(undefined)
    localStorage.setItem(CONFIG_KEY, JSON.stringify(nextConfig))
    setStatus('已清除当前浏览器保存的令牌，页面现在只能查看数据')
  }

  async function pullGitHubRecords() {
    if (!requireGitHubConnection()) {
      return
    }

    try {
      setStatus('正在从 GitHub 读取最新数据...')
      const githubFile = await fetchRecordsFromGitHub(config)
      setRecords(githubFile.records)
      setFileSha(githubFile.sha)
      setStatus(`已从 GitHub 读取 ${githubFile.records.length} 条记录`)
    } catch (error) {
      setStatus((error as Error).message)
    }
  }

  async function syncRecordsToGitHub(nextRecords: EditingRecord[], successText: string) {
    if (!requireGitHubConnection()) {
      return false
    }

    setIsSaving(true)
    setStatus('正在保存到 GitHub...')
    try {
      const latestFile = fileSha
        ? { records, sha: fileSha }
        : await fetchRecordsFromGitHub(config)
      const mergedRecords = normalizeRecords([
        ...latestFile.records.filter(
          (record) => !nextRecords.some((nextRecord) => nextRecord.date === record.date),
        ),
        ...nextRecords,
      ])
      const nextSha = await saveRecordsToGitHub(
        config,
        mergedRecords,
        latestFile.sha,
      )
      setRecords(mergedRecords)
      setFileSha(nextSha)
      setStatus(successText)
      return true
    } catch (error) {
      setStatus((error as Error).message)
      return false
    } finally {
      setIsSaving(false)
    }
  }

  async function saveAllRecordsToGitHub(
    nextRecords: EditingRecord[],
    successText: string,
  ) {
    if (!requireGitHubConnection()) {
      return false
    }

    setIsSaving(true)
    setStatus('正在保存到 GitHub...')
    try {
      const latestFile = fileSha
        ? { sha: fileSha }
        : await fetchRecordsFromGitHub(config)
      const nextSha = await saveRecordsToGitHub(
        config,
        normalizeRecords(nextRecords),
        latestFile.sha,
      )
      setFileSha(nextSha)
      setStatus(successText)
      return true
    } catch (error) {
      setStatus((error as Error).message)
      return false
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!requireGitHubConnection()) {
      return
    }

    const editCount = Math.max(0, Number(form.editCount))
    const complexCount = Math.max(0, Number(form.complexCount))
    if (!form.date) {
      setStatus('请选择日期')
      return
    }
    if (complexCount > editCount) {
      setStatus('复杂片数量不能大于当天剪辑数量')
      return
    }

    const existingRecord = records.find((record) => record.date === form.date)
    const now = new Date().toISOString()
    const nextRecord: EditingRecord = {
      date: form.date,
      editCount,
      complexCount,
      note: form.note.trim(),
      videoNames: existingRecord?.videoNames,
      complexVideoNames: existingRecord?.complexVideoNames,
      editor: existingRecord?.editor,
      createdAt: existingRecord?.createdAt ?? now,
      updatedAt: now,
    }
    const saved = await syncRecordsToGitHub(
      [nextRecord],
      '已保存到 GitHub，GitHub Pages 会稍后自动更新',
    )
    if (saved) {
      setForm({ ...defaultForm, date: form.date })
    }
  }

  async function importRecordsFromFile(file: File) {
    if (!requireGitHubConnection()) {
      return
    }

    try {
      const fileName = file.name.toLowerCase()
      const importedRecords = fileName.endsWith('.xlsx') || fileName.endsWith('.xls')
        ? normalizeRecords(await parseXlsxFile(file))
        : fileName.endsWith('.json')
          ? normalizeRecords(
              ((JSON.parse(await file.text()) as { records?: EditingRecord[] }).records ?? []).map(
                (record) => ({
                  ...record,
                  complexCount: Math.min(record.complexCount, record.editCount),
                  videoNames: record.videoNames ?? [],
                  complexVideoNames: record.complexVideoNames ?? [],
                }),
              ),
            )
          : normalizeRecords(parseImportedRecords(await file.text()))

      if (importedRecords.length === 0) {
        setStatus('没有识别到可导入的数据，请确认表格里有日期和剪辑数量')
        return
      }

      const mergedRecords = normalizeRecords([
        ...records.filter(
          (record) =>
            !importedRecords.some(
              (importedRecord) => importedRecord.date === record.date,
            ),
        ),
        ...importedRecords,
      ])
      setRestorePoint({
        label: `撤销导入 ${file.name}`,
        records,
      })
      const saved = await saveAllRecordsToGitHub(
        mergedRecords,
        `已导入并同步 ${importedRecords.length} 天数据`,
      )
      if (saved) {
        setRecords(mergedRecords)
      }
    } catch (error) {
      setStatus(
        `导入失败：${(error as Error).message || '文件格式没有识别出来，请确认是腾讯文档导出的表格'}`,
      )
    }
  }

  async function deleteRecordsByRange() {
    if (!requireGitHubConnection()) {
      return
    }

    if (!deleteRange.startDate || !deleteRange.endDate) {
      setStatus('请选择要删除的开始日期和结束日期')
      return
    }
    if (deleteRange.startDate > deleteRange.endDate) {
      setStatus('开始日期不能晚于结束日期')
      return
    }

    const matchedRecords = records.filter(
      (record) =>
        record.date >= deleteRange.startDate && record.date <= deleteRange.endDate,
    )
    if (matchedRecords.length === 0) {
      setStatus('这个日期范围内没有可删除的数据')
      return
    }
    const confirmed = window.confirm(
      `确认删除 ${deleteRange.startDate} 到 ${deleteRange.endDate} 的 ${matchedRecords.length} 天数据吗？`,
    )
    if (!confirmed) {
      return
    }

    const nextRecords = normalizeRecords(
      records.filter(
        (record) =>
          record.date < deleteRange.startDate || record.date > deleteRange.endDate,
      ),
    )
    setRestorePoint({
      label: `撤销删除 ${deleteRange.startDate} 到 ${deleteRange.endDate}`,
      records,
    })
    const saved = await saveAllRecordsToGitHub(
      nextRecords,
      `已删除 ${matchedRecords.length} 天数据，并同步到 GitHub`,
    )
    if (saved) {
      setRecords(nextRecords)
    }
  }

  async function undoLastDataChange() {
    if (!restorePoint) {
      return
    }
    if (!requireGitHubConnection()) {
      return
    }
    const previousRecords = restorePoint.records
    const saved = await saveAllRecordsToGitHub(
      previousRecords,
      '已撤销并同步到 GitHub',
    )
    if (saved) {
      setRecords(previousRecords)
      setStatus(`已${restorePoint.label}`)
      setRestorePoint(null)
    }
  }

  function exportRecords(format: 'json' | 'csv') {
    const fileDate = getChinaDateString(new Date())
    if (format === 'json') {
      createDownload(
        `剪辑数据备份-${fileDate}.json`,
        `${JSON.stringify({ records: normalizeRecords(records) }, null, 2)}\n`,
        'application/json;charset=utf-8',
      )
      setStatus('已导出 JSON 备份')
      return
    }

    const csv = [
      [
        '日期',
        '剪辑数量',
        '复杂片数量',
        '备注',
        '片名列表',
        '复杂片名列表',
        '剪辑人员',
        '创建时间',
        '更新时间',
      ],
      ...normalizeRecords(records)
        .reverse()
        .map((record) => [
          record.date,
          record.editCount,
          record.complexCount,
          record.note,
          (record.videoNames ?? []).join(' / '),
          (record.complexVideoNames ?? []).join(' / '),
          record.editor ?? '',
          record.createdAt,
          record.updatedAt,
        ]),
    ]
      .map((row) => row.map(csvEscape).join(','))
      .join('\n')
    createDownload(`剪辑数据备份-${fileDate}.csv`, `\uFEFF${csv}\n`, 'text/csv;charset=utf-8')
    setStatus('已导出 CSV 备份')
  }

  function editRecord(record: EditingRecord) {
    setForm({
      date: record.date,
      editCount: String(record.editCount),
      complexCount: String(record.complexCount),
      note: record.note,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <main className="app-shell">
      <div className="page-jinx-corner left-corner" aria-hidden="true">
        <div className="q-jinx corner-jinx">
          <i></i>
          <b></b>
          <span></span>
        </div>
      </div>
      <div className="page-jinx-corner right-corner" aria-hidden="true">
        <div className="q-jinx corner-jinx">
          <i></i>
          <b></b>
          <span></span>
        </div>
      </div>
      <section className="hero-section" aria-label="剪辑统计概览">
        <div className="hero-copy">
          <p className="eyebrow">个人剪辑数据站</p>
          <h1>每天记录一点，剪辑成果自己会发光。</h1>
          <p className="hero-text">
            记录每日剪辑数量和复杂片数量，自动汇总本周、本月和今年的节奏。
          </p>
          <div className="status-pill" aria-live="polite">
            {status}
          </div>
        </div>
        <div className="cartoon-board" aria-hidden="true">
          <div className="board-top">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div className="sparkle one"></div>
          <div className="sparkle two"></div>
          <div className="q-jinx main-jinx">
            <i></i>
            <b></b>
            <span></span>
          </div>
          <div className="q-jinx corner-jinx top-left">
            <i></i>
            <b></b>
            <span></span>
          </div>
          <div className="q-jinx corner-jinx bottom-right">
            <i></i>
            <b></b>
            <span></span>
          </div>
        </div>
      </section>

      <section className="summary-layout" aria-label="核心统计">
        <div className="summary-grid">
          {summary.map((item) => (
            <article className={`stat-card ${item.tone}`} key={item.label}>
              <span className="stat-icon"></span>
              <p>{item.label}</p>
              <strong>{item.value}</strong>
              <small>{item.sub}</small>
            </article>
          ))}
        </div>
        <aside className="panel side-chart" aria-label="最近七天柱形统计图">
          <div className="section-heading">
            <p>趋势柱形图</p>
            <h2>最近七天</h2>
          </div>
          <div className="bar-chart">
            {chartRecords.map((record) => (
              <div className="bar-item" key={record.date}>
                <div className="bar-track">
                  <span
                    className="bar edit-bar"
                    style={{ height: `${(record.editCount / chartMax) * 100}%` }}
                  ></span>
                  <span
                    className="bar complex-bar"
                    style={{
                      height: `${(record.complexCount / chartMax) * 100}%`,
                    }}
                  ></span>
                </div>
                <small>{record.date.slice(5)}</small>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span>剪辑数量</span>
            <span>复杂片</span>
          </div>
        </aside>
      </section>

      <section className="work-grid">
        <form className="panel record-form" onSubmit={handleSubmit}>
          <div className="section-heading">
            <p>每日录入</p>
            <h2>新增或修改一天的数据</h2>
          </div>
          <label>
            日期
            <input
              type="date"
              value={form.date}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
            />
          </label>
          <div className="form-row">
            <label>
              剪辑数量
              <input
                min="0"
                type="number"
                value={form.editCount}
                onChange={(event) =>
                  setForm({ ...form, editCount: event.target.value })
                }
              />
            </label>
            <label>
              复杂片数量
              <input
                min="0"
                type="number"
                value={form.complexCount}
                onChange={(event) =>
                  setForm({ ...form, complexCount: event.target.value })
                }
              />
            </label>
          </div>
          <label>
            备注
            <textarea
              rows={4}
              placeholder="例如：广告短片、口播包装、修改返工..."
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
            />
          </label>
          <button
            className="primary-button"
            type="submit"
            disabled={isSaving || !isGitHubReady}
          >
            {isSaving
              ? '同步中...'
              : isGitHubReady
                ? '保存今天的数据'
                : '填入令牌后才能保存'}
          </button>
        </form>

        <section className="panel">
          <div className="section-heading">
            <p>GitHub 同步</p>
            <h2>把数据写回仓库文件</h2>
          </div>
          <div className={`sync-state ${isGitHubReady ? 'ready' : 'locked'}`}>
            <strong>{isGitHubReady ? '当前浏览器已连接，可保存数据' : '未连接令牌，只能查看公开数据'}</strong>
            <span>
              {isGitHubReady
                ? '用户名、仓库名、分支和令牌都会记在这台设备的浏览器里。'
                : '公开访问者看得到页面，但没有你的令牌就不能写入仓库。'}
            </span>
          </div>
          <div className="form-row">
            <label>
              用户名
              <input
                placeholder="a2938145246-cpu"
                value={config.owner}
                onChange={(event) =>
                  setConfig({ ...config, owner: event.target.value.trim() })
                }
              />
            </label>
            <label>
              仓库名
              <input
                placeholder="Miku-s-editing-data"
                value={config.repo}
                onChange={(event) =>
                  setConfig({ ...config, repo: event.target.value.trim() })
                }
              />
            </label>
          </div>
          <label>
            分支
            <input
              value={config.branch}
              onChange={(event) =>
                setConfig({ ...config, branch: event.target.value.trim() })
              }
            />
          </label>
          <label>
            令牌
            <input
              type="password"
              placeholder="只保存在当前浏览器"
              value={config.token}
              onChange={(event) =>
                setConfig({ ...config, token: event.target.value.trim() })
              }
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={saveConfig}>
              保存并记住设置
            </button>
            <button type="button" onClick={pullGitHubRecords} disabled={!isGitHubReady}>
              读取最新数据
            </button>
            <button type="button" onClick={clearConfig}>
              清除令牌
            </button>
          </div>
          <p className="helper-text">
            令牌需要仓库内容读取和写入权限。公开页面不会包含你的令牌，换手机或换浏览器时需要再填一次令牌。
          </p>
        </section>
      </section>

      <section className="panel import-panel">
        <div className="section-heading">
          <p>腾讯文档导入</p>
          <h2>把以前的数据一次合并进来</h2>
        </div>
        <div className="import-box">
          <label>
            上传腾讯文档导出的表格
            <input
              accept=".csv,.xlsx,.xls,.json,text/csv,application/json"
              disabled={!isGitHubReady || isSaving}
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  void importRecordsFromFile(file)
                }
                event.target.value = ''
              }}
            />
          </label>
          <p className="helper-text">
            支持 CSV、XLSX、XLS 和 JSON。表头建议使用：日期、剪辑数量、复杂片数量、备注。导入时会按日期合并，同一天的新数据会覆盖旧数据。
          </p>
        </div>
      </section>

      <section className="panel maintenance-panel">
        <div className="section-heading">
          <p>数据维护</p>
          <h2>删错可撤回，重要数据可备份</h2>
        </div>
        <div className="maintenance-grid">
          <div className="maintenance-box">
            <strong>按日期范围删除</strong>
            <div className="form-row">
              <label>
                开始日期
                <input
                  type="date"
                  value={deleteRange.startDate}
                  onChange={(event) =>
                    setDeleteRange({
                      ...deleteRange,
                      startDate: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                结束日期
                <input
                  type="date"
                  value={deleteRange.endDate}
                  onChange={(event) =>
                    setDeleteRange({
                      ...deleteRange,
                      endDate: event.target.value,
                    })
                  }
                />
              </label>
            </div>
            <div className="button-row">
              <button
                type="button"
                disabled={!isGitHubReady || isSaving}
                onClick={() => void deleteRecordsByRange()}
              >
                删除范围内数据
              </button>
              <button
                disabled={!restorePoint || !isGitHubReady || isSaving}
                type="button"
                onClick={() => void undoLastDataChange()}
              >
                {restorePoint ? restorePoint.label : '暂无可撤销操作'}
              </button>
            </div>
          </div>
          <div className="maintenance-box">
            <strong>导出备份</strong>
            <p className="helper-text">
              上传 GitHub 前后都可以导出，建议导入大批量数据前先备份一次。
            </p>
            <div className="button-row">
              <button type="button" onClick={() => exportRecords('json')}>
                导出 JSON 备份
              </button>
              <button type="button" onClick={() => exportRecords('csv')}>
                导出 CSV 表格
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel reports-panel">
        <div className="section-heading">
          <p>自动报告</p>
          <h2>周总结和月总结</h2>
        </div>
        <div className="report-grid">
          <article className="report-card">
            <strong>本周总结</strong>
            <span>{currentWeek} 至 {getWeekEnd(today)}</span>
            <p>剪辑 {getTotals(weekRecords).editCount} 个，复杂片 {getTotals(weekRecords).complexCount} 个，活跃日均 {getTotals(weekRecords).averagePerActiveDay} 个。</p>
          </article>
          <article className="report-card">
            <strong>本月总结</strong>
            <span>{currentMonth}</span>
            <p>剪辑 {getTotals(monthRecords).editCount} 个，复杂片 {getTotals(monthRecords).complexCount} 个，活跃日均 {getTotals(monthRecords).averagePerActiveDay} 个。</p>
          </article>
          {reports.slice(0, 4).map((report) => (
            <a
              className="report-card"
              href={`${import.meta.env.BASE_URL}${report.path}`}
              key={report.path}
            >
              <strong>{report.title}</strong>
              <span>{report.period}</span>
              <p>剪辑 {report.editCount} 个，复杂片 {report.complexCount} 个，活跃日均 {report.averagePerActiveDay ?? 0} 个。</p>
            </a>
          ))}
        </div>
        <p className="helper-text">
          部署到 GitHub 后，自动流程会在每周一晚上生成周总结，并在月底生成月总结。
        </p>
      </section>

      <section className="panel search-panel">
        <div className="section-heading">
          <p>搜索筛选</p>
          <h2>快速找到某段时间的剪辑记录</h2>
        </div>
        <div className="filter-grid">
          <label>
            关键词
            <input
              placeholder="搜索日期或备注"
              value={filters.keyword}
              onChange={(event) =>
                setFilters({ ...filters, keyword: event.target.value })
              }
            />
          </label>
          <label>
            开始日期
            <input
              type="date"
              value={filters.startDate}
              onChange={(event) =>
                setFilters({ ...filters, startDate: event.target.value })
              }
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={filters.endDate}
              onChange={(event) =>
                setFilters({ ...filters, endDate: event.target.value })
              }
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={filters.complexOnly}
              onChange={(event) =>
                setFilters({ ...filters, complexOnly: event.target.checked })
              }
            />
            只看有复杂片的日期
          </label>
        </div>
        <div className="result-summary">
          <span>筛选结果 {filteredRecords.length} 天</span>
          <span>剪辑 {filteredTotals.editCount} 个</span>
          <span>复杂片 {filteredTotals.complexCount} 个</span>
        </div>
        <div className="record-list">
          {filteredRecords.map((record) => (
            <article className="record-row" key={record.date}>
              <div>
                <strong>
                  {record.date}
                  {record.editor ? <small> · {record.editor}</small> : null}
                </strong>
                <p>
                  {record.note ||
                    ((record.videoNames?.length ?? 0) > 0
                      ? `已列出 ${record.videoNames?.length ?? 0} 个片名`
                      : '没有备注')}
                </p>
                {(record.videoNames?.length ?? 0) > 0 && (
                  <ul className="video-name-list">
                    {record.videoNames?.map((name, index) => {
                      const isComplex = (record.complexVideoNames ?? []).includes(name)
                      return (
                        <li
                          className={isComplex ? 'complex-video-name' : undefined}
                          key={`${record.date}-${name}-${index}`}
                        >
                          {name}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
              <div className="record-numbers">
                <span>{record.editCount} 个</span>
                <small>复杂 {record.complexCount}</small>
              </div>
              <button type="button" onClick={() => editRecord(record)}>
                编辑
              </button>
            </article>
          ))}
          {filteredRecords.length === 0 && (
            <div className="empty-state">还没有符合条件的数据</div>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
