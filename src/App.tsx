import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type EditingRecord = {
  date: string
  editCount: number
  complexCount: number
  note: string
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
  ratio: number
  generatedAt: string
  path: string
}

const DATA_PATH = 'public/data/editing-records.json'
const DATA_URL = `${import.meta.env.BASE_URL}data/editing-records.json`
const REPORTS_URL = `${import.meta.env.BASE_URL}data/reports.json`
const CONFIG_KEY = 'editing-stats-github-config'
const emptyConfig: GitHubConfig = {
  owner: '',
  repo: '',
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

  return {
    editCount,
    complexCount,
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
  return savedConfig ? (JSON.parse(savedConfig) as GitHubConfig) : emptyConfig
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

function normalizeImportDate(value: string) {
  const cleaned = value.trim().replace(/[年月]/g, '-').replace(/日/g, '')
  const match = cleaned.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (!match) {
    return ''
  }
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function findColumn(headers: string[], candidates: string[]) {
  return headers.findIndex((header) =>
    candidates.some((candidate) => header.includes(candidate)),
  )
}

function parseImportedRecords(text: string) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''))
  return parseImportedRows(rows)
}

function parseImportedRows(rows: string[][]) {
  if (rows.length === 0) {
    return []
  }

  const headers = rows[0].map((header) => header.trim())
  const dateIndex = findColumn(headers, ['日期', '时间', '日子', 'date'])
  const editIndex = findColumn(headers, [
    '剪辑数量',
    '剪辑数',
    '剪辑',
    '完成数量',
    '数量',
  ])
  const complexIndex = findColumn(headers, ['复杂片数量', '复杂片', '复杂'])
  const noteIndex = findColumn(headers, ['备注', '说明', '内容', 'note'])
  const hasHeader = dateIndex >= 0 && editIndex >= 0
  const dataRows = hasHeader ? rows.slice(1) : rows
  const now = new Date().toISOString()

  return dataRows
    .map((row) => {
      const date = normalizeImportDate(row[hasHeader ? dateIndex : 0] ?? '')
      if (!date) {
        return null
      }
      const editCount = Math.max(
        0,
        Number(String(row[hasHeader ? editIndex : 1] ?? '').replace(/[^\d.]/g, '') || 0),
      )
      const complexCount = Math.max(
        0,
        Number(String(row[hasHeader && complexIndex >= 0 ? complexIndex : 2] ?? '').replace(/[^\d.]/g, '') || 0),
      )
      const note = row[hasHeader && noteIndex >= 0 ? noteIndex : 3] ?? ''

      return {
        date,
        editCount,
        complexCount: Math.min(complexCount, editCount),
        note,
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
      raw: false,
      dateNF: 'yyyy-mm-dd',
    },
  )
  const rows = rawRows.map((row) =>
    row.map((cell) =>
      cell instanceof Date ? getChinaDateString(cell) : String(cell ?? '').trim(),
    ),
  )
  return parseImportedRows(rows)
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
  const [status, setStatus] = useState('正在读取公开数据...')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    fetchPublicRecords()
      .then((loadedRecords) => {
        setRecords(loadedRecords)
        setStatus(`已读取 ${loadedRecords.length} 条记录`)
      })
      .catch((error: Error) => setStatus(error.message))
    fetchReports().then(setReports)
  }, [])

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

  function saveConfig() {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
    setStatus('GitHub 设置已保存在当前浏览器')
  }

  async function pullGitHubRecords() {
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
    if (!config.owner || !config.repo || !config.branch || !config.token) {
      setStatus('已在页面中更新，请补全 GitHub 设置后再同步到仓库')
      return
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
    } catch (error) {
      setStatus((error as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

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
      createdAt: existingRecord?.createdAt ?? now,
      updatedAt: now,
    }
    const nextRecords = normalizeRecords([
      ...records.filter((record) => record.date !== form.date),
      nextRecord,
    ])

    setRecords(nextRecords)
    await syncRecordsToGitHub(
      [nextRecord],
      '已保存到 GitHub，GitHub Pages 会稍后自动更新',
    )
    if (config.owner && config.repo && config.branch && config.token) {
      setForm({ ...defaultForm, date: form.date })
    }
  }

  async function importRecordsFromFile(file: File) {
    const fileName = file.name.toLowerCase()
    const importedRecords = fileName.endsWith('.xlsx') || fileName.endsWith('.xls')
      ? normalizeRecords(await parseXlsxFile(file))
      : fileName.endsWith('.json')
        ? normalizeRecords(
            ((JSON.parse(await file.text()) as { records?: EditingRecord[] }).records ?? []).map(
              (record) => ({
                ...record,
                complexCount: Math.min(record.complexCount, record.editCount),
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
    setRecords(mergedRecords)
    setStatus(`已导入 ${importedRecords.length} 天数据，请同步到 GitHub 保存`)
    await syncRecordsToGitHub(
      importedRecords,
      `已导入并同步 ${importedRecords.length} 天数据`,
    )
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
          <button className="primary-button" type="submit" disabled={isSaving}>
            {isSaving ? '同步中...' : '保存今天的数据'}
          </button>
        </form>

        <section className="panel">
          <div className="section-heading">
            <p>GitHub 同步</p>
            <h2>把数据写回仓库文件</h2>
          </div>
          <div className="form-row">
            <label>
              用户名
              <input
                placeholder="你的 GitHub 用户名"
                value={config.owner}
                onChange={(event) =>
                  setConfig({ ...config, owner: event.target.value.trim() })
                }
              />
            </label>
            <label>
              仓库名
              <input
                placeholder="personal-editing-stats"
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
              保存设置
            </button>
            <button type="button" onClick={pullGitHubRecords}>
              读取最新数据
            </button>
          </div>
          <p className="helper-text">
            令牌需要仓库内容读取和写入权限。公开页面不会包含你的令牌。
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
            上传腾讯文档导出的 CSV 表格
            <input
              accept=".csv,.xlsx,.xls,.json,text/csv,application/json"
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
            支持 CSV、XLSX 和 JSON。表头建议使用：日期、剪辑数量、复杂片数量、备注。导入时会按日期合并，同一天的新数据会覆盖旧数据。
          </p>
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
            <p>剪辑 {getTotals(weekRecords).editCount} 个，复杂片 {getTotals(weekRecords).complexCount} 个。</p>
          </article>
          <article className="report-card">
            <strong>本月总结</strong>
            <span>{currentMonth}</span>
            <p>剪辑 {getTotals(monthRecords).editCount} 个，复杂片 {getTotals(monthRecords).complexCount} 个。</p>
          </article>
          {reports.slice(0, 4).map((report) => (
            <a
              className="report-card"
              href={`${import.meta.env.BASE_URL}${report.path}`}
              key={report.path}
            >
              <strong>{report.title}</strong>
              <span>{report.period}</span>
              <p>剪辑 {report.editCount} 个，复杂片 {report.complexCount} 个，占比 {report.ratio}%。</p>
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
                <strong>{record.date}</strong>
                <p>{record.note || '没有备注'}</p>
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
