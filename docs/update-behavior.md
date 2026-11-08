# 更新行为说明

## 检查范围与版本选择

范围按 DSH Host 返回的安装归属判断：`installed === true`，排除 `official`、`optional` 和 `availability === 'installation'`。已关闭的自行安装插件也参与检查。

npm 来源先读取版本索引，再检查最新的最多 20 个候选稳定版本，选择兼容版本。检查可跨越原安装声明中的 `^0.x` 范围，实际安装固定为精确版本。预发布、已弃用或未声明 `dsh.bundle.patch` 的版本不作为更新目标。

GitHub 来源检查公共仓库中的稳定 Release；没有稳定 Release 时读取原分支或默认分支。读取目标提交的 `package.json` 确认包名与版本，安装目标固定为提交 SHA。替换前还须从原来源或当前 `pnpm-lock.yaml` 确认旧版提交；无法确认时保留原插件。

DSH 兼容性使用宿主的 `evaluatePluginCompatibility`，另外检查 Node.js、操作系统和 CPU 限制。不会创建版本豁免。

## 查询来源

npm 查询沿用当前 profile 的代理、认证、注册表与镜像顺序，私有源不会自动改用公共源。GitHub 检查只访问 `api.github.com` 的公共 API，不读取凭据；限额与网络错误会显示在检查结果中。

自动检查默认每 24 小时执行一次。应用关闭期间暂停，启动后补检查。检查失败后最早 1 小时再自动重试，手动检查不受此限制。

## 安装与失败恢复

点击更新后重新核对当前版本、来源、目标版本和兼容性。其他浏览器或 CLI 已改变安装状态时，旧检查结果会被拒绝，需重新检查。

- 支持 HMR 时，调用 DSH 自身的 `removeBundle` 与 `installBundle` 替换插件。
- 仅启动加载的 profile 通过原生安装服务覆盖安装，并显示需要重启。
- 保留更新前的启用或关闭选择。
- 安装失败时尝试恢复旧版本；恢复失败会明确报告原版本的安装入口。
- 原生服务要求批准脚本时停止本次更新，由用户通过 DSH 原生流程处理，不自动批准。
- 检查器不会在处理请求时卸载自己。本地链接安装通过更新原目录、重新构建和重启来维护。

替换期间应等待本次更新完成再发起其他安装。DSH rc.5 的移除与安装是两个独立操作，恢复仍需要原来源可访问。

## 保存位置

偏好和检查结果保存在：

```text
<DSH_HOME>/storages/dsh-plugin-updater/<profile 目录哈希>.json
```

遵循 `DSH_HOME`，默认使用 DSH 自身的 `~/.dsh` 解析规则。不同 profile 使用不同文件。保存使用 DSH 的文件锁与原子写入；无法保存时会显示原因。

## 页面接入

Host 的 `src/index.mjs` 注册 Typert RPC，`engine.mjs` 管理调度和更新任务；`sources.mjs`、`npm.mjs` 处理来源与版本，`store.mjs` 保存设置与结果。

Client 的 `client.cjs` 使用官方详情页 slot。总览暂无对应的公开 slot，`dom.cjs` 依据现有 `data-plugin-group="bundles"` 和 `data-plugin-package` 标记增强该分组，退出时清理新增节点，保留原有启停开关。

宿主同时提供 `updateBundle` 方法并将包标记为 `updatable` 时，详情页的版本更新按钮和“可更新”标签由宿主提供。归属在检查开始前即确定，异步检查完成后保持一致。旧宿主、GitHub 等其他来源保留更新器的详情操作。不兼容原因、版本说明、总览更新操作和每日提醒继续由更新器提供。

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Scrollbar | DSH 插件管理页 | 宿主主题与页面布局 | 总览、详情 | scripts/browser-check.mjs |
