---
version: alpha
name: Plugin Updater
description: DSH 插件管理页中的版本检查、状态说明和更新入口。
omitted:
  - section: colors
    reason: 颜色来自宿主 DSH 的语义 CSS 变量。
  - section: typography
    reason: 字体继承宿主，版本说明沿用 src/dom.cjs 的 12px 样式。
  - section: rounded
    reason: 沿用宿主控件和现有 src/dom.cjs 控件样式。
  - section: spacing
    reason: 宿主插件页面拥有分组、卡片和滚动布局。
  - section: components
    reason: 更新入口的归属见本文和 docs/update-behavior.md。
---

# Plugin Updater

## Overview

产品面向自行安装 DSH 插件的用户。以已安装插件列表和详情页为工作界面，使用现有中文操作文案。产品说明提供中英文版本，市场范围未限定。

沿用 DSH 插件管理页的图标、卡片和启停开关。版本差异和清晰的更新状态承担信息层级。

## Colors

宿主语义变量是规范来源。DSH 主题变量经过 `src/dom.cjs` 的 CSS 消费，生成到 `lib/client.js`。正文使用 `--dsw-alias-label-primary`，说明使用 `--dsw-alias-label-tertiary`，操作和提示使用 `--dsw-alias-state-business-primary`。

## Typography

字体继承宿主。版本、状态和辅助操作采用现有的 12px 字号与 19px 行高。

## Layout

宿主拥有页面与卡片滚动，更新器只增强已安装分组及详情扩展点。沿用 640px 窄窗口规则。

## Elevation & Depth

沿用宿主表面、边框和交互反馈。更新说明位于卡片内。

## Shapes

沿用现有按钮、徽标和图标容器的圆角。

## Components

详情页更新操作由单一实现拥有。宿主提供 `updateBundle` 且包被标记为 `updatable` 时，使用宿主详情更新入口与可更新标签。其他包和旧宿主使用更新器的详情扩展。

更新器持续提供总览中的版本、操作、原因和自动检查设置。更新结果异步到达时保持上述归属。禁用、错误、不兼容和待重启状态使用具体文案。

## Do's and Don'ts

- 每个详情页只呈现一个可执行的版本更新入口。
- 检查范围遵循宿主返回的安装归属。
- 操作使用按钮或链接语义，保留宿主启停开关及键盘行为。
