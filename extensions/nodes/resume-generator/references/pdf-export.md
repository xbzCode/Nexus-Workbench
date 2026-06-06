# PDF 导出指南

简历 HTML 文件支持两种 PDF 导出方式。

## ⚠️ 重要：两种方式的本质区别

| 特性 | 浏览器打印 (Ctrl+P) | 一键导出 (html2canvas+jsPDF) |
|------|---------------------|-------------------------------|
| PDF 文字可编辑 | ✅ 是（原生文字） | ❌ 否（图片嵌入） |
| 文字可选/可搜索 | ✅ 是 | ❌ 否 |
| 效果还原度 | ✅ 完美 | ✅ 截图级高保真（3x PNG + 逐字渲染）|
| 背景色保留 | 需勾选"背景图形" | ✅ 自动包含 |

**如果需要可编辑、可搜索文字的 PDF，必须使用浏览器打印方式。**

## 方式一：浏览器打印（🔑 推荐 - 生成可编辑文字 PDF）

### 使用步骤

1. 在浏览器中打开简历 HTML 文件
2. 按 `Ctrl+P`（Mac: `Cmd+P`）
3. 目标打印机选择"另存为 PDF"
4. 调整设置：
   - 纸张：A4
   - 边距：默认或最小
   - 背景图形：✅ 勾选（重要！否则背景色和线条会丢失）
   - 缩放：100%（默认）
5. 点击"保存"

### 模板中的打印优化

模板 HTML 已内置 `@media print` 样式：

```css
@media print {
  /* 隐藏操作按钮 */
  .toolbar, .export-btn, .print-hint { display: none !important; }

  /* 固定 A4 尺寸 */
  @page { size: A4; margin: 0; }

  /* 防止板块跨页断裂 */
  .section { break-inside: avoid; }
  .entry { break-inside: avoid; }
  .sidebar-section { break-inside: avoid; }

  /* 确保背景色打印 */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
```

### 注意事项

- **务必勾选"背景图形"**，否则分隔线、背景色等不会打印
- Chrome 打印效果最佳，Edge 次之，Firefox 可能有细微差异
- 如遇内容溢出，可开启紧凑模式（`--compact`）减少间距

## 方式二：一键导出（html2canvas + jsPDF - 图片型 PDF）

### 技术架构

使用独立的 `html2canvas` + `jsPDF` 库（**不使用 html2pdf.js**，后者存在已知 bug）：

```
html2canvas(截图) → canvas 像素扫描裁剪空白 → jsPDF(PNG嵌入) → 下载
```

### 已解决的已知问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 白色半透明蒙层 | `position:fixed` 元素被 html2canvas 渲染为视口层叠加 | 导出前将 toolbar 的 position 改为 static |
| 文字模糊/不清晰 | JPEG 有损压缩 + scale=2 低分辨率 | 改用 PNG 无损格式 + scale=3x + `letterRendering:true` |
| 空白第二页 | canvas 高度刚好超出 A4 几毫米 | 像素级底部空白裁剪 + 溢出≤3mm强制单页 + 最后一页内容检测跳过 |
| 动画导致半透明 | fadeIn 动画在导出时重播 | 导出前设置 `animation:none` |
| 字体未加载完成就截图 | 异步字体加载 | `document.fonts.ready` + 300ms 延迟 |
| 双栏模板侧边栏高度不足 | flex 子元素未撑满 | `.sidebar` 加 `align-self:stretch` |
| 长文本被截断 | 容器无换行策略 | `.edu-detail` 等加 `word-break:break-all` |

### 核心导出代码要点

```javascript
// ① 库引入（独立加载，不用 html2pdf.js）
<script src="html2canvas@1.4.1"></script>
<script src="jspdf@2.5.1"></script>

// ② 关键：toolbar position → static（防止蒙层）
toolbar.style.cssText = 'position:static;visibility:hidden;...';

// ③ 关键：禁用动画（防止半透明层）
page.style.animation = 'none';

// ④ 等待字体加载
await document.fonts.ready;
await new Promise(r => setTimeout(r, 300));

// ⑤ 高质量截图
html2canvas(page, {
  scale: 3,              // 3x 分辨率
  letterRendering: true, // 逐字渲染
  backgroundColor: '#ffffff',
  useCORS: true
})

// ⑥ 像素扫描裁剪底部空白
// 从底部向上找最后一个有内容的像素行

// ⑦ 生成 PDF（PNG 格式，无损压缩关闭）
new jsPDF({ compress: false })
pdf.addImage(imgData, 'PNG', ...)

// ⑧ 多页时检测最后一页是否实质空白并跳过
```

### 配置参数说明

| 参数 | 值 | 说明 |
|------|-----|------|
| scale | 3 | 3 倍分辨率，保证文字锐利清晰 |
| letterRendering | true | 逐字渲染模式，中文效果显著提升 |
| imageFormat | PNG | 无损格式，避免 JPEG 对文字的模糊效应 |
| compress | false | jsPDF 不压缩，保持图片质量 |
| blankThreshold | 250 | RGB < 250 视为有内容像素 |
| overflowTolerance | 3mm | 超出 A4 不超过 3mm 时强制单页输出 |
| lastPageContentRatio | 5% | 最后一页有效行不足 5% 则视为空页跳过 |

### 注意事项

- 需要网络连接（首次加载 html2canvas 和 jsPDF CDN）
- `position:static` 处理是核心——html2canvas 会把 fixed 定位元素作为独立视口层渲染，visibility:hidden 无法阻止其 box-shadow 和背景
- 如需自定义导出行为，修改 `<script>` 区域的 `exportPDF()` 函数即可

## 两种方式对比

| 对比项 | 浏览器打印 | 一键导出 |
|--------|-----------|---------|
| 文字可编辑 | ✅ 是 | ❌ 否（图片） |
| ATS 兼容 | ✅ 好 | ❌ 差（图片文字不可解析） |
| 网络依赖 | ❌ 无 | ✅ 需联网加载 CDN |
| 分页控制 | ✅ 精确 | ✅ 自动裁剪+智能分页 |
| 背景色 | 需手动勾选"背景图形" | ✅ 自动包含 |
| 中文字体 | ✅ 完美 | ✅ 良好（3x 截图） |
| 导出速度 | 快 | 较慢（需渲染） |
| 推荐场景 | 正式投递、存档 | 快速预览、分享 |
