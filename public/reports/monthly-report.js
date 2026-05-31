const dataUrl = `../data/editing-records.json?ts=${Date.now()}`
const numberFormat = new Intl.NumberFormat('zh-CN')

const $ = (id) => document.getElementById(id)
let latestPayload = null
let selectedMonth = ''

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

function getMonthKey(date) {
  return date.slice(0, 7)
}

function getRequestedMonth() {
  const params = new URLSearchParams(window.location.search)
  return params.get('month') || getMonthKey(getChinaDateString())
}

function getMonthTitle(month) {
  const [year, monthNumber] = month.split('-')
  return `${year}年${Number(monthNumber)}月`
}

function getTotals(records) {
  const editCount = records.reduce((sum, record) => sum + Number(record.editCount || 0), 0)
  const complexCount = records.reduce(
    (sum, record) => sum + Number(record.complexCount || 0),
    0,
  )
  const activeDays = records.filter((record) => Number(record.editCount || 0) > 0).length
  return {
    editCount,
    complexCount,
    activeDays,
    averagePerActiveDay:
      activeDays > 0 ? Math.round((editCount / activeDays) * 10) / 10 : 0,
    complexRatio: editCount > 0 ? Math.round((complexCount / editCount) * 100) : 0,
  }
}

function formatList(items) {
  return items?.length ? items.join('；') : ''
}

function setText(id, value) {
  const element = $(id)
  if (element) element.textContent = value
}

function renderTable(records) {
  const body = $('detailRows')
  if (!body) return
  body.innerHTML = ''

  if (!records.length) {
    const row = document.createElement('tr')
    row.innerHTML = '<td class="empty-state" colspan="4">这个月份还没有剪辑记录。</td>'
    body.append(row)
    return
  }

  for (const record of records) {
    const row = document.createElement('tr')
    const details = formatList(record.complexVideoNames) || record.note || '-'
    row.innerHTML = `
      <td>${record.date}</td>
      <td>${numberFormat.format(record.editCount || 0)}</td>
      <td>${numberFormat.format(record.complexCount || 0)}</td>
      <td>${details}</td>
    `
    body.append(row)
  }
}

function renderChart(records) {
  const chart = $('barChart')
  if (!chart) return
  chart.innerHTML = ''

  if (!records.length) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = '暂无可展示数据'
    chart.append(empty)
    return
  }

  const maxValue = Math.max(...records.map((record) => record.editCount || 0), 1)
  for (const record of records) {
    const group = document.createElement('div')
    group.className = 'bar-group'
    const editHeight = Math.max(4, ((record.editCount || 0) / maxValue) * 100)
    const complexHeight = Math.max(4, ((record.complexCount || 0) / maxValue) * 100)
    group.innerHTML = `
      <div class="bar-pair" title="${record.date}：剪辑 ${record.editCount || 0}，复杂片 ${record.complexCount || 0}">
        <span class="bar edit" style="height:${editHeight}%"></span>
        <span class="bar complex" style="height:${complexHeight}%"></span>
      </div>
      <span class="bar-label">${record.date.slice(5)}</span>
    `
    chart.append(group)
  }
}

function getMonthRecords(payload, month) {
  return (payload.records || [])
    .filter((record) => getMonthKey(record.date) === month)
    .sort((a, b) => a.date.localeCompare(b.date))
}

function getMonthGroups(payload) {
  return [...new Set((payload.records || []).map((record) => getMonthKey(record.date)))]
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))
}

function renderAccordion(payload, activeMonth) {
  const accordion = $('monthAccordion')
  if (!accordion) return
  accordion.innerHTML = ''

  for (const month of getMonthGroups(payload)) {
    const records = getMonthRecords(payload, month)
    const totals = getTotals(records)
    const bestDay = [...records].sort((a, b) => (b.editCount || 0) - (a.editCount || 0))[0]
    const item = document.createElement('article')
    item.className = `month-item${month === activeMonth ? ' is-open' : ''}`
    item.innerHTML = `
      <button class="month-trigger" type="button" aria-expanded="${month === activeMonth}">
        <span class="month-name">${getMonthTitle(month)}</span>
        <span class="month-summary">剪辑 ${numberFormat.format(totals.editCount)} 条 · 复杂片 ${numberFormat.format(totals.complexCount)} 条 · 记录 ${records.length} 天</span>
        <span class="month-arrow">⌄</span>
      </button>
      <div class="month-panel">
        <div class="month-panel-grid">
          <span><b>${numberFormat.format(totals.editCount)}</b>剪辑总数</span>
          <span><b>${numberFormat.format(totals.complexCount)}</b>复杂片</span>
          <span><b>${totals.complexRatio}%</b>复杂片占比</span>
          <span><b>${bestDay ? bestDay.date.slice(5) : '-'}</b>最高产出日</span>
        </div>
      </div>
    `
    item.querySelector('.month-trigger')?.addEventListener('click', () => {
      selectMonth(month, true)
    })
    accordion.append(item)
  }
}

function selectMonth(month, updateUrl = false) {
  if (!latestPayload) return
  selectedMonth = month
  if (updateUrl) {
    const url = new URL(window.location.href)
    url.searchParams.set('month', month)
    window.history.replaceState({}, '', url)
  }
  renderReport(latestPayload, selectedMonth)
  renderAccordion(latestPayload, selectedMonth)
}

function renderReport(payload, month) {
  const records = (payload.records || [])
    .filter((record) => getMonthKey(record.date) === month)
    .sort((a, b) => a.date.localeCompare(b.date))
  const totals = getTotals(records)
  const bestDay = [...records].sort((a, b) => (b.editCount || 0) - (a.editCount || 0))[0]
  const goal = Number(payload.monthlyGoals?.[month] || 0)
  const progress = goal > 0 ? Math.round((totals.editCount / goal) * 100) : 0

  setText('monthLabel', `${getMonthTitle(month)} 实时月报`)
  setText('reportTitle', `${month} 剪辑数据情况表`)
  setText('totalEdits', numberFormat.format(totals.editCount))
  setText('complexTotal', numberFormat.format(totals.complexCount))
  setText('complexRatio', `复杂片占比 ${totals.complexRatio}%`)
  setText('recordDays', `${records.length} 天`)
  setText('activeDays', `${totals.activeDays} 天`)
  setText('dailyAverage', `${totals.averagePerActiveDay} 条`)
  setText('bestDay', bestDay ? `${bestDay.date.slice(5)} / ${bestDay.editCount} 条` : '-')
  setText('goalProgress', goal > 0 ? `${progress}%` : '-')
  setText('goalText', goal > 0 ? `目标 ${goal} 条，已完成 ${totals.editCount} 条` : '未设置本月目标')
  setText('totalTrend', `截至目前记录 ${records.length} 天`)
  setText(
    'updatedAt',
    `读取时间：${new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date())}`,
  )
  setText('statusText', `数据来源：网站仓库最新数据文件。打开或刷新本页时会即时重新计算 ${month} 总结。`)

  renderTable(records)
  renderChart(records)
}

async function loadReport() {
  setText('statusText', '正在读取最新剪辑数据...')
  const response = await fetch(dataUrl, { cache: 'no-store' })
  if (!response.ok) throw new Error('数据文件读取失败')
  const payload = await response.json()
  latestPayload = payload
  const months = getMonthGroups(payload)
  const requestedMonth = getRequestedMonth()
  selectedMonth = months.includes(requestedMonth) ? requestedMonth : months[0] || requestedMonth
  selectMonth(selectedMonth)
}

$('refreshButton')?.addEventListener('click', () => {
  window.location.reload()
})

loadReport().catch((error) => {
  console.error(error)
  setText('reportTitle', '数据读取失败')
  setText('statusText', '没有读取到最新数据，请稍后刷新，或检查数据文件是否存在。')
})
