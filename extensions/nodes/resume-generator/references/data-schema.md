# 简历数据 Schema

用于结构化文件输入（JSON/YAML）的数据格式定义。

## JSON 示例

```json
{
  "meta": {
    "template": "modern",
    "accent": "slate",
    "compact": false,
    "showPhoto": true
  },
  "header": {
    "name": "张三",
    "title": "高级前端工程师",
    "phone": "138-0000-0000",
    "email": "zhangsan@example.com",
    "location": "北京",
    "website": "https://zhangsan.dev",
    "github": "https://github.com/zhangsan",
    "linkedin": "",
    "photo": ""
  },
  "sections": {
    "workExperience": [
      {
        "company": "某某科技有限公司",
        "position": "高级前端工程师",
        "startDate": "2021.06",
        "endDate": "至今",
        "description": [
          "负责公司核心产品的前端架构设计与开发",
          "主导前端工程化建设，搭建 CI/CD 流水线",
          "优化首屏加载性能，FCP 从 3.2s 降至 1.1s"
        ],
        "tags": ["React", "TypeScript", "Webpack"]
      }
    ],
    "education": [
      {
        "school": "某某大学",
        "major": "计算机科学与技术",
        "degree": "本科",
        "startDate": "2013.09",
        "endDate": "2017.06",
        "gpa": "3.8/4.0",
        "honors": ["国家奖学金", "优秀毕业生"],
        "courses": []
      }
    ],
    "skills": [
      {
        "category": "编程语言",
        "skills": ["JavaScript", "TypeScript", "Python", "Go"]
      },
      {
        "category": "前端框架",
        "skills": ["React", "Vue 3", "Next.js", "TailwindCSS"]
      }
    ],
    "projects": [
      {
        "name": "智能数据看板",
        "role": "前端负责人",
        "startDate": "2022.03",
        "endDate": "2022.12",
        "description": "面向企业客户的实时数据可视化平台",
        "highlights": [
          "日均处理 500万+ 数据点，0 延迟渲染",
          "支持 20+ 种图表类型，拖拽式配置"
        ],
        "tags": ["React", "ECharts", "WebSocket"]
      }
    ],
    "summary": "8年前端开发经验，专注于高性能 Web 应用架构。擅长 React 生态与工程化建设，有从 0 到 1 搭建前端团队的经验。注重代码质量与团队协作，持续关注前端前沿技术。",
    "certificates": [
      {
        "name": "AWS Solutions Architect",
        "issuer": "Amazon Web Services",
        "date": "2023.05"
      }
    ],
    "languages": [
      { "language": "中文", "level": "母语" },
      { "language": "英语", "level": "流利（IELTS 7.5）" }
    ]
  }
}
```

## YAML 示例

```yaml
meta:
  template: modern
  accent: slate
  compact: false
  showPhoto: true

header:
  name: 张三
  title: 高级前端工程师
  phone: 138-0000-0000
  email: zhangsan@example.com
  location: 北京
  website: https://zhangsan.dev
  github: https://github.com/zhangsan

sections:
  workExperience:
    - company: 某某科技有限公司
      position: 高级前端工程师
      startDate: "2021.06"
      endDate: 至今
      description:
        - 负责公司核心产品的前端架构设计与开发
        - 主导前端工程化建设，搭建 CI/CD 流水线
      tags:
        - React
        - TypeScript
        - Webpack

  education:
    - school: 某某大学
      major: 计算机科学与技术
      degree: 本科
      startDate: "2013.09"
      endDate: "2017.06"
      gpa: 3.8/4.0
      honors:
        - 国家奖学金
        - 优秀毕业生

  skills:
    - category: 编程语言
      skills:
        - JavaScript
        - TypeScript
        - Python
    - category: 前端框架
      skills:
        - React
        - Vue 3
        - Next.js

  projects:
    - name: 智能数据看板
      role: 前端负责人
      startDate: "2022.03"
      endDate: "2022.12"
      description: 面向企业客户的实时数据可视化平台
      highlights:
        - 日均处理 500万+ 数据点，0 延迟渲染
      tags:
        - React
        - ECharts

  summary: 8年前端开发经验，专注于高性能 Web 应用架构。

  certificates:
    - name: AWS Solutions Architect
      issuer: Amazon Web Services
      date: "2023.05"

  languages:
    - language: 中文
      level: 母语
    - language: 英语
      level: 流利（IELTS 7.5）
```

## 字段校验规则

| 规则 | 说明 |
|------|------|
| `header.name` | 必填，不能为空 |
| `sections.workExperience` 或 `sections.education` | 至少一项存在且非空数组 |
| `startDate` / `endDate` | 格式为 `YYYY.MM`，endDate 可为 `"至今"` |
| `meta.template` | 可选值为 modern/professional，默认 modern |
| `meta.accent` | 可选值为 slate/blue/emerald/violet/rose/amber，默认 slate |
| `meta.compact` | 布尔值，默认 false |
| `meta.showPhoto` | 布尔值，默认 true |
| 空字符串字段 | 自动隐藏该字段（不显示空白行） |
| 空数组字段 | 自动隐藏整个板块 |
```
)
