# QuotaRing v1.0.0 Windows 说明

QuotaRing v1.0.0 是基于 Codex Usage Card macOS v0.9.4 二次开发的非官方 Windows 任务栏额度工具。
保留原版 MIT 许可证、圆环颜色、百分比、详情卡内容和额度选择规则。

## 安装与日常使用

当前提供 x64 版本：Windows 11 已在开发阶段实机使用，Windows 10 为兼容目标，尚未实机验证。
要求 Node.js 24+、Microsoft Edge WebView2 Runtime、.NET Framework 4.8，
以及可运行并已登录的 Codex CLI。安装时可从已有 Codex 桌面客户端定位 CLI；支持商店版
`OpenAI.Codex` 与常见独立安装位置。运行时无需 npm 安装或管理员身份。

1. 完整解压，双击 `安装-Windows.cmd`。
2. 等待额度读取完成，圆环将横向排列在**主任务栏右侧、通知区域左边**。
3. **点击圆环**，在圆环正上方居中展开原样式详情卡；再次点击可收起。
   点击外部或按 Esc 也会收起。
4. 默认随 Windows 登录自动显示。任务栏自动隐藏时跟随隐藏；全屏视频、演示或游戏时暂时隐藏，
   恢复普通窗口后重新显示。

显示条在预设尺寸上限内按任务栏高度和实际显示缩放，同时调整圆环、数字、小标记和窗口尺寸。
详情卡使用基础字号，按内容测量宽高，并随显示缩放换算实际像素；分辨率改变主要触发位置和屏幕边界重算。
目前尚未专门跟随 Windows 的独立“文本大小”设置。
显示条中，五小时额度的文字标签替换为 5 个小圆点，周额度标签替换为 7 个小竖条；
亮起数量表示距离重置还剩多少小时/天，向上取整（一天为连续 24 小时），其余槽位保留淡色。
例如剩余 4 小时 59 分仍亮 5 点，剩余 6 天 23 小时仍亮 7 条；不足最后一个单位时保留 1 个，
到重置时点归零，读取到新的重置时间后重新计算。重置时间未知或数据过期时显示 `—`。
计时标记沿用对应圆环颜色，并每秒根据本机时间更新；正常额度查询仍为每 60 秒一次。
圆环和百分比继续表示剩余额度，详情卡的文字标签与内容保持不变。
例如 48 像素高的任务栏、150% 绘制比例下，Plus 双环显示条为 207×42 像素。
详情卡宽度按两列内容收紧，保留原字号和内边距，最大为 300 逻辑像素。
开发阶段的两项额度和重置时间在 150% 绘制时曾测得约 306 像素宽，仅作为示例；高度随重置卡和到期信息调整。
定位时尽量限制在当前主屏幕边界内；更多分辨率、字体设置和缩放组合尚未逐一验证。

额度由独立后台 `codex.exe app-server` 查询，与 Codex 桌面窗口无连接依赖。
关闭桌面窗口后仍继续查询；正常每 60 秒刷新，也处理服务端额度更新通知。
查询失败会显示不可用并重试，不会一直保留看似有效的旧额度。
只显示 Codex 额度；本次不实现普通 Chat 聊天额度、其他账号或 IDE 登录兼容性。

QuotaRing 默认安装在 `%LOCALAPPDATA%\OpenAI\CodexUsageCard`。该路径及安装标记沿用开发阶段名称，以便识别已有安装。
登录项只启动插件后台，不会额外打开 Codex。不修改客户端文件或签名，不创建额外桌面启动器。
你原来的 Codex 图标继续正常启动原客户端。

从旧 Windows 左栏版升级时，会停止旧后台、移除旧左栏显示，并按已保存的备份恢复原快捷方式和
曾映射的客户端登录自启。后续手动修改过的快捷方式会保留并提示核对。
安装不会关闭或重启当前工作窗口。旧版已打开的本机调试端口会在该客户端正常退出后关闭；
新任务栏版的日常运行不使用这个端口，也不依赖桌面页面结构。

## 额度规则

- 额度为 `100 - usedPercent`，与上下文长度无关。
- 保留原版仅 Plus 使用双环的规则；详情卡标签仍为 `5h额度` / `周额度`，显示条用计时图形替代文字。
- Pro 和其他套餐保留原版单环选择逻辑；缺失指定窗口时不会改用第一个可用窗口。
- 双环详情标题为 `Codex 剩余额度`。
- 重置时间、重置卡等内容由原格式化逻辑生成，不更改账户额度数据。
- 部分 Free 账号返回 30 天额度窗口时，详情卡可以列出数据，但任务栏圆环可能显示 `—`，卡片标题也可能提示暂时无法读取；本版保留这一限制。

## 命令行与诊断

```powershell
node manage.cjs install
node manage.cjs status
node manage.cjs read
node manage.cjs start
node manage.cjs stop
node manage.cjs uninstall
```

文件夹中的 `启动-Windows.cmd` 是手动启动面板的备用入口；登录后通常无需使用。
`read` 只读取真实额度，不启动模型任务。
双击 `诊断-Windows.cmd` 可查看运行状态，不输出令牌、聊天内容或账号标识。

| 状态 | 含义与处理 |
| --- | --- |
| `displayMode: taskbar` | 已安装任务栏版。 |
| `desktopRequired: false` | 读取额度无需桌面窗口。 |
| `background: stopped` | 执行 `node manage.cjs start`，或检查安装目录的 `agent.log`。 |
| `dataAvailable: false` | 检查现有 Codex 登录、网络与 CLI。 |
| `panel.ready: false` | 检查 WebView2 Runtime、显示组件文件与日志。 |
| `panel.visibility.unobscured: false` | 窗口中心被其他窗口遮挡；仅有 `nativeVisible: true` 不代表屏幕上可见。 |
| `panel.rendering.badgeFits/detailsFits: false` | 内容大于网页视口，存在尺寸或缩放不匹配。 |
| `panel.hiddenReason: fullscreen` | 全屏时正常隐藏，退出全屏后恢复。 |
| `panel.hiddenReason: taskbar-hidden` | 跟随隐藏的任务栏，任务栏出现后恢复。 |
| `backgroundAtLogin: false` | 如需登录自启，重新运行默认安装。 |

指定路径或关闭自启：

```powershell
node manage.cjs install --app "C:\Path\ChatGPT.exe" --codex-bin "C:\Path\codex.exe"
node manage.cjs install --no-auto-start
```

`--auto-start` 显式开启登录自启（默认开启）。`--install-dir` 可自定义位置，后续管理命令需使用
同一路径，或设置 `CODEX_USAGE_CARD_HOME`。安装保留当前 `CODEX_HOME` 路径以复用登录环境，不保存密钥。
`--no-shortcuts` 是保留的隔离测试模式，不是任务栏版的日常安装方式。

安装检查、后台查询、`read` 和诊断共用 CLI 定位规则。默认定位会先使用现有 CLI；若保存的客户端版本目录已失效，会重新检测当前客户端位置并在后台重连时重试。显式设置的 `--codex-bin` 路径及已有安装保存的显式路径优先保留，失效时报告错误，不自动改用另一个 CLI。此机制只处理程序路径，不跟随其他客户端切换账号，也不修改登录信息。

登录自启脚本以 Windows Script Host 支持的 Unicode 编码保存，支持中文安装路径；启动时携带该安装的目录参数。

## 移除插件

1. 双击项目文件夹中的 `卸载-Windows.cmd`。
2. 程序停止额度后台和显示窗口，删除插件自己的登录启动项。
3. 删除插件已知安装文件，以及带有插件归属标记的显示缓存；未知用户文件保留。
4. 如还存在旧版集成备份，会恢复对应原快捷方式和原登录设置。
5. 保留 Codex 客户端、账号登录和聊天记录。确认卸载完成后，可自行删除下载的项目文件夹。

Windows 版删除的是自己的已知文件；这里没有改为回收站，也不会卸载 Codex。
卸载会先核对待删除文件及其父目录和缓存标记；发现符号链接、目录联接或缓存归属不明时，会停止卸载并报告原因，此时不会提示卸载成功。
若后台曾异常退出，卸载会核对并清理归属明确、进程已结束的残留状态锁。锁中含陌生文件、记录无效、实例发生变化或无法确认进程状态时，会中止并保留安装标记，不递归删除锁目录，也不强制终止进程。

## 隐私与实现

独立额度后台使用 Codex CLI 的标准输入输出协议和已有登录环境，不直接读取认证文件、聊天内容
或会话数据库，不启动模型任务，也没有新增遥测上传。
显示窗口只接收已经格式化的额度数据，页面来自本地文件，禁止外部导航与网页权限请求。
WebView2 使用安装目录下的专属缓存，不共享用户浏览器配置。
后台通过本机 WMI 独立启动，避免因 Codex 工具进程退出而被回收；不安装系统服务、不修改防火墙。
自动更新保持关闭。

协议和系统机制参考 [OpenAI app-server](https://learn.chatgpt.com/docs/app-server)、
[Microsoft Win32_ProcessStartup](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-processstartup)
和 [WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/)。

## 开发与打包

```powershell
npm ci
npm run build:panel
npm test
npm run package
```

构建脚本从 Microsoft NuGet 下载固定版本 `Microsoft.Web.WebView2 1.0.4314.35`，
使用系统 .NET Framework C# 编译器构建 x64 窗口，并生成复用原组件的本地页面。
分发包包含窗口程序、可读源码、必要 WebView2 SDK 文件及其许可证；不包含用户缓存、配置、
认证信息或 macOS 二进制。打包输出位于 `dist`：`QuotaRing-Windows-x64-v1.0.0.zip` 和 `SHA256SUMS.txt`。
未来 Windows 任务栏或 Codex 协议变化仍可能需要重新适配。

打包脚本在缺少已构建的显示组件或所需文件时会停止并提示。源码仓库忽略 `node_modules/`、下载的 WebView2 SDK、`windows/panel/bin/`、`dist/`、本地测试及预览缓存；这些忽略规则不影响将已构建的运行组件加入安装包。

## 版本与来源

项目名称为 QuotaRing，发布版本为 v1.0.0。运行状态使用 `1.0.0`，Windows 清单使用 `1.0.0.0` 的四段版本格式。显示组件文件名 `CodexUsagePanel.exe`、安装目录及内部归属标记继续沿用已有名称，以保持现有安装的识别。

原项目版本与压缩包哈希见 [UPSTREAM.md](../vendor/UPSTREAM.md)，原始 MIT 许可证及版权声明见 [LICENSE](../LICENSE)。
