# 上游来源记录

## 原项目

- 项目：[Lorie7813/codex-usage-card](https://github.com/Lorie7813/codex-usage-card)
- 参考版本：macOS v0.9.4，Release 标签 `v0.9.4-beta.1`。
- 原始附件：`CodexUsageCard-macOS-0.9.4.zip`。
- SHA256：`e41cbb00fd01b785eb0cac73a946115a35dd2d9a2410c196ec7287ce4b1737f8`。
- 下载并核对哈希的日期：2026-10-30。

以上版本、标签、文件名与哈希记录的是原项目，不是 QuotaRing 的发布编号。原始 macOS 压缩包及解压参考文件不随 QuotaRing 源码仓库或 Windows 安装包分发。

## QuotaRing 的衍生内容

根目录 `agent.cjs` 基于上述发布包中的同名文件开发，保留额度读取、额度窗口选择、圆环配色与详情卡等共用逻辑。Windows 任务栏窗口、独立后台生命周期、显示适配、重置倒计时标记和安装管理由本项目在 Windows 适配过程中实现。

QuotaRing 从 `v1.0.0` 开始独立编号。Windows 的行为及与上游的差异见 [Windows 说明](../docs/windows.md)；原始 MIT 许可证与版权声明完整保留在 [LICENSE](../LICENSE)。

部分内部安装路径、归属标记、页面桥接名称和组件文件名沿用开发阶段的名称，用于已有安装的识别与迁移，不代表继续使用旧项目的发布版本号。

## 第三方运行组件

Windows 显示窗口使用 Microsoft Edge WebView2。构建脚本下载固定版本 `Microsoft.Web.WebView2 1.0.4314.35` SDK，下载缓存不提交到源码仓库。发布包包含所需的 WebView2 组件及 `windows/panel/bin/WEBVIEW2-LICENSE.txt`，保留 Microsoft 的许可证。
