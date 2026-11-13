# beijingh1b-watchdog — 北京 H-1B 预约监测（安全模拟版）

**当前没有启用真实空位监测或真实自动预约。** 你已确认尚无获准的查询／预约接口，先完成模拟自动预约。此版本不访问签证网站，不登录、不处理验证码、不点击预约按钮。

固定范围：北京（Beijing）、H-1B、北京时间 2026-12-07 至 2027-01-08，两端包含。官方入口：<https://www.usvisascheduling.com/en-US/schedule/>。

这是从 [yalewinters/visa-slot-watcher](https://github.com/yalewinters/visa-slot-watcher) `4754d0077e69b0df7546ce4314ef12cbedcec084` 派生的本地 Node.js 安全版，**不是可直接加载的 Chrome 扩展**。原版完整源码和历史另行保存；原版支持的网页自动登录、自动检查、自动预约没有在安全版中启用。原版界面和其他扩展功能也不属于本版可运行界面。不要把“保存原版全部源码”理解为“原版全部功能已安全上线”。

## GitHub 下载与 Muse 交接

当前交付仓库：https://github.com/mumuheee/beijingh1b-watchdog 。这是用户创建的独立仓库，不是 GitHub fork 网络中的仓库。

- [下载完整交付包](artifacts/DELIVERY.zip?raw=true)
- [Muse 开发设计文档](docs/DESIGN-zh.md)
- [审计与实施报告](docs/IMPLEMENTATION_REPORT.md)
- [测试记录](artifacts/safe-tests.txt)
- [完整原版源码](artifacts/upstream-original.zip?raw=true)

GitHub 页面打开 ZIP 后，可点击 Download raw 下载。仓库根目录是可运行的安全模拟版；原扩展源码保留在单独压缩包中。

## macOS 安装与离线演示

1. 从 <https://nodejs.org/> 安装 Node.js 22 或更新的 LTS 版本。确认 `node --version`。无需安装 npm 依赖。
2. 解压安全版源码，终端进入该目录。路径中有空格时使用引号。
3. 执行：

```bash
npm test
node src/cli.js demo
node src/cli.js demo-booking
cp config.example.json config.local.json
chmod 600 config.local.json
```

`demo` 演示出现→重复→消失→失败→格式错误→再次出现，重复出现会再次提醒。`demo-booking` 另演示自动挑选最早的确认日期，生成一条 `SIMULATED_ONLY_NO_REAL_APPOINTMENT` 记录。重复响应不会生成第二条模拟预约。

这些演示固定使用测试时钟 2026-11-13；不会把历史 fixture 伪装成实时数据。直接用 `check` 读取过期 fixture 会报告 `STALE_RESPONSE`，属于预期行为。

```bash
node src/cli.js check config.local.json
```

`check` 最多每 30 分钟读取一次配置中的文件。状态保存在配置所在目录的 `.runtime/mock` 或 `.runtime/authorized-file`，文件权限 0600。普通 mock 检查始终只输出终端消息。设置 `"mockAutoBook": true` 可让新鲜 mock 数据触发模拟预约；默认 false。它不会产生真实预约。

## 手机推送：Telegram 或 ntfy

把 `config.local.json` 的 `notification` 改成 `telegram` 或 `ntfy`。演示和 mock 常规检查不会自动给手机发送消息。以下**主动测试命令**会发送一条标有 TEST ONLY 的模拟消息：

```bash
node src/cli.js test-notification config.local.json
```

先在 macOS 的“钥匙串访问 / Keychain Access”中通过界面新建普通密码项目（New Password Item），**不要把真实密钥写进配置、源码、终端历史或聊天**：

| 渠道 | 项目名称 / 服务名称 | Account | Password 内容 |
|---|---|---|---|
| Telegram | `beijing-h1b.TELEGRAM_BOT_TOKEN` | `slot-monitor` | Bot token |
| Telegram | `beijing-h1b.TELEGRAM_CHAT_ID` | `slot-monitor` | 你的 chat ID |
| ntfy | `beijing-h1b.NTFY_TOPIC` | `slot-monitor` | 20–128 位随机主题，仅字母、数字、下划线、连字符 |
| ntfy | `beijing-h1b.NTFY_TOKEN` | `slot-monitor` | 对该主题有发布权限的 token |

Telegram 需先与自己的 bot 建立聊天。ntfy 在手机端订阅同一主题；主题名难猜不等于访问控制，请在 ntfy 设置主题访问限制（套餐支持情况以服务方为准）。消息中只有日期、北京、H-1B 和官网链接；两家推送服务会接收到这些信息。不要使用公共群组／公开主题来接收不希望公开的信息。

程序通过 `/usr/bin/security find-generic-password` 读取这些项目，不把值落盘或输出。首次访问可能触发系统权限提示；后台 launchd 运行前请先在终端测试，确保钥匙串可访问。也支持同名环境变量用于临时运行，但本项目不提供明文 `.env` 文件。

本次交付只测试了通知 HTTP 请求的替身，没有使用你的凭据发送消息。

## 获得真实 provider 授权后才启用定时

当前唯一的真实数据输入能力是**读取本地标准化 JSON 文件**。必须由你另行安排一个获准的数据服务更新该文件；本程序不会替你从保护网站抓取数据。仅在配置中填写“已授权”并不能取得网站或服务商许可。

获得书面授权后，将 provider 改为 `authorized-file`，`path` 指向外部服务原子更新的快照文件，填写真实授权记录：

```json
{
  "provider": {"kind": "authorized-file", "path": "/absolute/path/authorized-snapshot.json"},
  "notification": "ntfy",
  "scheduleEnabled": true,
  "mockAutoBook": false,
  "authorization": {
    "providerId": "实际获准的服务标识",
    "evidence": "实际授权文档的位置或编号",
    "expiresAt": "2027-01-09T00:00:00+08:00",
    "location": "Beijing",
    "visaType": "H-1B",
    "minimumIntervalMinutes": 30
  }
}
```

授权必须覆盖北京 H-1B 查询，并允许每 30 分钟一次；若服务只允许更低频率，本版会拒绝启用。授权记录由本机用户负责真实性，程序无法自行认证法律或合同许可。`mockAutoBook` 即使为 true 也不会对 authorized-file 数据做真实预约：会明确返回 `LIVE_BOOKING_NOT_IMPLEMENTED`。

```bash
node src/cli.js validate-schedule config.local.json
node src/cli.js run config.local.json
```

macOS 后台方式（与上面的 `run` 二选一）：安装 Python 3 后执行：

```bash
python3 scripts/install-launch-agent.py "$PWD/config.local.json"
```

安装器只在 macOS 运行，先校验显式启用和 provider 授权，才写入 `~/Library/LaunchAgents/local.beijing-h1b.monitor.plist` 并加载。plist 不含密钥。每 1800 秒调用一次带授权门控的 `scheduled-check`；每次重新验证授权，目标窗口结束后拒绝检查。

理论上持续唤醒运行时每天 48 次。休眠、退出登录、程序失败或系统调度延迟会减少次数；不会补发密集检查。不要同时启用两个不同目录的监控副本。

卸载后台任务：

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.beijing-h1b.monitor.plist"
rm "$HOME/Library/LaunchAgents/local.beijing-h1b.monitor.plist"
```

没有在你的 Mac 上安装后台任务；本次在 Linux 环境验证逻辑，macOS 钥匙串和 launchd 需在你的机器上做平台验证。

## 数据格式与判定

参见 `test/fixtures/available.json`。要求 schemaVersion=1、status=ok、明确 Beijing / H-1B、带时区的 observedAt、complete 布尔值和 appointments 数组。每条包含 date 和 status（available / unavailable / inferred）。date 可以为严格 ISO 日期，或包含时区的 ISO 时间戳；后者按 Asia/Shanghai 转为日期。

- **confirmed / available**：provider 明确声明有空位，才可提醒或模拟预约；并不表示官网已为你保留名额。
- **inferred**：仅推测，绝不触发新提醒／预约，也不证明旧空位消失。
- **unavailable**：明确无空位，删除该日期的当前出现状态。
- **parsing/provider error**：JSON、schema、日期、范围身份、冲突、过期等错误。保留前次状态，不当成“无空位”。

只有成功、完整且不含推测日期的快照，才根据日期缺席判断消失。部分快照只更新明确状态。已通知日期消失后再次出现会重新通知；推送失败不会标记为已发送。失败后只在下一次**重新确认**该日期时重试推送。观察时间倒退则拒绝更新。

响应上限 1 MiB、最多 1000 条记录；新鲜度最长 35 分钟，允许未来时钟误差 5 分钟。新接口需编写经过验证的适配器，不能把原项目启发式解析输出直接标记为 confirmed。

## 状态恢复与限制

进程锁禁止同一状态目录并发运行。进程被强制终止后可能遗留 `.runtime/<provider>/monitor.lock`；先确认没有监控进程，再手动删除锁。不要在进程仍运行时删除锁。损坏的状态文件会停止检查，不静默重置；可停机后备份状态，再人工恢复。

推送采用尽力而为的至少一次策略：推送已送达但保存状态前崩溃，可能产生重复提醒。模拟预约只记录日期，不模拟真实时间段、多人申请、费用、重约额度或服务端竞争条件。未来真实自动预约需要独立授权、时间段／申请人校验、服务端幂等键及结果核对，目前没有实现。

旧版扩展中已有的明文凭据不会因解压本项目而自动删除。请先关闭旧版自动检查和自动预约，在旧版设置中“Forget saved credentials”，然后从 Chrome 扩展管理中移除旧扩展。若有浏览器备份／配置同步副本，应按你的备份策略清理；若怀疑已泄露，修改密码和安全问题答案。本版不读取旧浏览器配置，也不会迁移那些凭据。

## 审计与来源

参见 `docs/IMPLEMENTATION_REPORT.md` 和交付的测试输出。原版所有 40 个已跟踪文件及完整 Git 历史分别保存在原版源码压缩包和 Git bundle 中。原版保留供查看／恢复，不代表其自动化路径已通过安全修复。安全版不包含这些可执行网页自动化路径。

原作者及贡献者保留版权，本修改版注明了来源及变更；继续遵守仓库的 CC BY-NC 4.0（非商业用途）许可证，见 LICENSE。
