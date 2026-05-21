# 个人剪辑数据统计网站

这是一个部署到 GitHub Pages 的静态网站，用来记录每天的剪辑数量、复杂片数量和备注，并自动统计今日、本周、本月与今年累计数据。

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建结果会输出到 `dist` 文件夹。

## 数据文件

公开数据保存在：

```text
public/data/editing-records.json
```

网页会读取这个文件作为初始数据。配置 GitHub 令牌后，网页表单会通过 GitHub 接口把新增或修改后的每日数据写回这个文件。

## GitHub 令牌权限

在 GitHub 创建 fine-grained personal access token，也就是细粒度个人访问令牌。

建议权限：

- Repository access：选择这个网站仓库
- Contents：Read and write

令牌只会保存在当前浏览器的本地存储中，不会写进仓库。

## GitHub Pages 部署

仓库推送到 GitHub 后：

1. 打开仓库 Settings，也就是设置。
2. 进入 Pages，也就是静态网页托管。
3. Source 选择 GitHub Actions，也就是 GitHub 自动化流程。
4. 推送到 `main` 分支后会自动构建和部署。
