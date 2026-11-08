# 启动约定：roost 怎么把 body 拉起来

- 状态：第 1 步定稿，2026-11-08
- **契约本体在施工单 §4**（`dsh-roost/docs/dsh-pet-施工单-body侧.md`）；本文是 body 侧的执行说明，
  有冲突以施工单为准。消息协议在 [`docs/protocol.md`](protocol.md)，不要混在一起。

## 1. 可执行文件

`pet.path` 指向 **body 打包后的可执行文件**，不是 Electron runtime，也不是 `.cmd` / `.bat` / `.ps1`：

- Windows：`dsh-roost-pet.exe`
- macOS：`dsh-roost-pet.app/Contents/MacOS/dsh-roost-pet`
- Linux：`dsh-roost-pet`

打包（第 8 步）之前，本仓库用 Electron 直接起，只给我们自己的假 roost 用：

```bash
<repo>/node_modules/electron/dist/electron.exe <repo> --protocol=1 ...
```

真 roost 在打包产物出来之前**不要**去猜 `electron.exe` 的路径；等第 8 步的
`dsh-roost-pet.exe` 落地再连。

spawn 的三条硬要求（施工单 §4.1）：

1. `stdio: ['pipe','pipe','pipe']`，不 `detached`；
2. 不经过 shell，路径有空格也不会被拆开；
3. `cwd` 是 body 可执行文件所在目录。

另外：**spawn 前从 env 里删掉 `ELECTRON_RUN_AS_NODE`**。Windows 上有些环境会继承它，
Electron 会当成 node 来跑，主进程根本不启动，表现就是"10 秒内没有 hello"。

`userData` 固定在安装目录的 `.userdata/`（开发态即 `<repo>/.userdata/`），不写 `%APPDATA%`。

## 2. 参数

roost 按这个顺序传，body 必须认：

| 参数 | 值 | 说明 |
| --- | --- | --- |
| `--protocol=1` | 整数 | 消息协议版本；不是 1 就 stderr 说明并按退出码 `2` 退 |
| `--size=1.0` | 0.5–2.0 | 初始大小；body 自己再夹一次 |
| `--position=bottom-right` | 五选一 | `bottom-right` / `bottom-left` / `top-right` / `top-left` / `center`；乱写当没传 |
| `--click-through=1` | `0` 或 `1` | `1` = 空白处点穿；缺省 `1` |
| `--pet=default` | 字符串 | 宠物包 id；加载失败先退回占位身体，不崩 |
| `--pet-dir=<目录>` | 路径 | body 自己的调试参数（契约里没有）：直接指一个包目录；显式指了却读不出来按退出码 `4` 退 |

之后 `config.pet.args` 的额外参数原样接上；不认识的一律忽略，不许因此退出。

**`--click-through=0` 只关掉"初始穿透"**：窗口一出现就整窗吃点击（调试窗口 / 看
DevTools 时用），指针碰过身体之后命中切换照常工作，不是一条会驻留的默认路径。
缺省永远是 `1`。

参数只当这次启动的初值，不写回 `settings.json` 覆盖主人手改的值。

## 3. 退出码

roost 只能从退出码和 stderr 判断这只身体是怎么没的：

| 码 | 含义 | body 什么时候用 | roost 怎么处理 |
| --- | --- | --- | --- |
| `0` | 正常 | 收到 `bye`；窗口关闭；握手完成后 stdin EOF | 不重拉 |
| `1` | 未分类崩溃 | stdin 读坏、渲染进程没了、被信号停 | 退避重试 |
| `2` | 握手 / 协议失败 | `--protocol` 不认；握手前 stdin 就 EOF；hello 还没发出去 stdout 就坏 | 退避重试 |
| `3` | 已经有一只 | 单实例锁没抢到 | 不重试，置 dead；信 `body.pid` 判断要不要清理 |
| `4` | 参数 / 配置错 | 参数缺值、`settings.json` / 宠物包根目录坏到起不来 | 不重试，置 dead |

如果 body 已经发过 `bye` 再退，不管退出码是什么都按正常退出算。

映射在 `lib/exit.js`，有单元测试；改之前先改施工单 §4.4，再改这张表。

### 3.1 单实例锁是谁拿着的：`.userdata/body.pid`

抢到锁的那只会在 `.userdata/body.pid` 写一行 JSON：

```json
{"pid":12345,"startedAt":"2026-11-08T13:40:00.000Z","version":"dsh-roost-pet/0.1.0"}
```

正常退出时删掉；崩溃时不删——这正是留给 roost 的线索。

第二只（退出码 `3`）会在 stderr 里写清楚锁的主人：

```
[dsh-roost-pet/0.1.0] warn 已经有一只 body 在跑了（单实例锁没抢到），这只退出。
pid=12345 启动于 2026-11-08T13:40:00.000Z 版本 dsh-roost-pet/0.1.0 存活=yes
```

- `存活=yes`：另一只正常在跑 → 放弃这轮启动。
- `存活=no` 或没有 `body.pid`：上一轮崩溃留下的，进程已经没了 → 可以清理后重起
  （Windows 上内核会释放锁，重起通常直接成功；`body.pid` 只是让 roost 别盲目重试）。

## 4. 时序

1. roost spawn body，开始计时；
2. body 10 秒内发 `hello`（正常在 100ms 内）；
3. roost 回 `hello`（`v=1`），握手完成；
4. `say` 的 ack 超时 8 秒；body 先 `ack` 再排队；
5. 正常收尾：roost 发 `bye` → body 回 `bye` → 3 秒内退出（码 `0`）；
6. 10 秒没握手：roost 杀进程，按 §4.5 退避（1 秒、5 秒，最多 3 次）。

## 5. 收日志

- **stderr**：人看的日志，随便收，不进协议。
- **stdout**：只有协议。读侧按行切，空行忽略（协议 §1.6）。Electron 在 Windows 启动时
  会先甩一个换行；body 已经把 `console.*` 全接到 stderr，但这一行是它自己的，挡不住，
  所以读侧必须容得下空行。
