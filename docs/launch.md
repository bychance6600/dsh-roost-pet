# 启动约定：roost 怎么把 body 拉起来

- 状态：第 1 步定稿，2026-11-08
- 协议本身在 [`docs/protocol.md`](protocol.md)，这里只定"进程怎么起、怎么退"。
- 两边要改这里的任何一条，先改这份文档。

## 1. 可执行文件

开发态（本仓库）：

```bash
# Windows
<repo>/node_modules/electron/dist/electron.exe <repo>
# 等价写法：node node_modules/electron/cli.js <repo>
```

打包后：`dsh-roost-pet.exe`，参数相同，不再需要项目目录。

三条硬要求：

1. **`stdio: ['pipe', 'pipe', 'pipe']`** —— stdin 是唯一输入，stdout 是协议。
2. **spawn 前从 env 里删掉 `ELECTRON_RUN_AS_NODE`**。Windows 上有些环境会继承它，
   Electron 会当成 node 来跑，主进程根本不启动，表现是"3 秒内没有 hello"。
3. **cwd 指到仓库根 / 安装目录**。

单实例：同一份 `userData` 只允许一只。第二只直接退出，退出码 `4`，stderr 写原因。

`userData` 固定在安装目录的 `.userdata/`（开发态即 `<repo>/.userdata/`），不写 `%APPDATA%`。

## 2. 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--size=1.0` | `1.0` | 缩放。1.0 时窗口 360×420（上 120 给气泡，下 300 给身体） |
| `--position=bottom-right` | `bottom-right` | `bottom-left` / `top-right` / `top-left` |
| `--click-through=1` | `1` | `0` = 整窗吃点击（调试窗口时用） |
| `--pet=default` | `default` | 宠物包 id；加载失败先退回占位身体，不崩 |

不认识的参数忽略，不报错、不退出。

## 3. 退出码

roost 只能从退出码和 stderr 判断这只身体是怎么没的：

| 码 | 含义 | roost 怎么处理 |
| --- | --- | --- |
| `0` | 正常：收到 `bye`，或握手完成后 stdin 关闭 | 正常结束，不要重启 |
| `3` | 握手失败：还没完成 hello 交换 stdin 就 EOF 了 | 记一笔，退避重启，先查自己这侧的握手 |
| `4` | 已经有一只在跑（单实例锁） | 不要重启；将来把输入转给那只 |
| `1` | 运行期出错：stdout/stdin 读写出错、渲染进程没了、窗口被关 | 退避重启，把 stderr 留下来 |
| 其他非 0（含负数 / NTSTATUS） | 进程崩溃（Chromium 崩、被杀） | 按崩溃处理，退避重启 |

被 roost 自己 kill 掉（握手超时、主动收工）不会有退出码，roost 自己知道。

退出码的映射在 `lib/exit.js`，有单元测试；改之前先改这张表。

## 4. 时序

1. roost spawn body，写第一行输入之前先等 body 的 `hello`；
2. body 3 秒内发 `hello`；
3. roost 回 `hello`（`v=1`），握手完成；
4. 正常说话 → roost 发 `bye` → body 回 `bye` → 3 秒内退出（码 0）；
5. roost 10 秒还没握手：kill，退避重启。

## 5. 收日志

- **stderr**：人看的日志，随便收，不进协议。
- **stdout**：只有协议。读侧按行切，空行忽略（协议 §1.6）。Electron 自己在 Windows 启动时
  会先甩一个换行，body 已经把 `console.*` 全接到 stderr，但这一行是它自己的，挡不住，
  所以读侧必须容得下空行。
