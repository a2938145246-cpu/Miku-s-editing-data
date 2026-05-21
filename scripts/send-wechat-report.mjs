import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const reportsPath = path.join(root, 'public/data/reports.json')

function readLatestReport() {
  if (!fs.existsSync(reportsPath)) {
    throw new Error('没有找到报告列表文件')
  }

  const reports = JSON.parse(fs.readFileSync(reportsPath, 'utf8')).reports ?? []
  if (reports.length === 0) {
    throw new Error('没有可推送的报告')
  }

  return reports.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0]
}

function createMarkdown(report) {
  const title = `剪辑数据${report.type === 'weekly' ? '周总结' : '月总结'}`
  return {
    title: `${title}：${report.period}`,
    markdown: [
      `# ${title}`,
      '',
      `周期：${report.period}`,
      '',
      `- 剪辑总数：${report.editCount}`,
      `- 复杂片数量：${report.complexCount}`,
      `- 复杂片占比：${report.ratio}%`,
      '',
      `报告文件：${report.path}`,
    ].join('\n'),
  }
}

async function sendByServerChan(report) {
  const sendKey = process.env.SERVER_CHAN_SENDKEY
  if (!sendKey) {
    return false
  }

  const { title, markdown } = createMarkdown(report)
  const body = new URLSearchParams({
    title,
    desp: markdown,
  })

  const response = await fetch(`https://sctapi.ftqq.com/${sendKey}.send`, {
    method: 'POST',
    body,
  })

  if (!response.ok) {
    throw new Error(`Server 酱推送失败：${response.status}`)
  }

  console.log('已通过 Server 酱推送到微信')
  return true
}

async function sendByWeCom(report) {
  const webhookUrl = process.env.WECHAT_WEBHOOK_URL
  if (!webhookUrl) {
    return false
  }

  const { markdown } = createMarkdown(report)
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        content: markdown,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`企业微信机器人推送失败：${response.status}`)
  }

  console.log('已通过企业微信机器人推送')
  return true
}

const report = readLatestReport()
const sent = (await sendByServerChan(report)) || (await sendByWeCom(report))

if (!sent) {
  console.log('没有配置微信推送密钥，跳过推送')
}
