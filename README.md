# dsh-roost-pet

roost 的身体。

一只没有对话框、没有按钮、没有台词的小窗：透明、置顶、默认不吃点击。
它不生成任何字——roost 说什么，它就把那句话原样冒出来；roost 不说，它就安静待着。

- 需求准绳：`dsh-roost/docs/dsh-pet-给roost设计.md`
- 施工单：`dsh-roost/docs/dsh-pet-施工单-body侧.md`
- 协议表：**[docs/protocol.md](docs/protocol.md)**（唯一来源，两边都照它写）

## 现在到哪一步

第 1 步：透明窗口 + 协议 v1 + 能冒泡。

已经有的：

- 透明、无边框、置顶、跳过任务栏的小窗（360×420，上面 120px 留给气泡，下面 300px 给身体）
- 默认整窗穿透；指针压到身体上才收点击（`setIgnoreMouseEvents(true, { forward: true })` + IPC 切换）
- 协议 v1 的握手、`say` 冒泡、`state` 只读显示、`act` 收下不演、`bye` / stdin EOF / 关窗退出
- 气泡时长 `clamp(字数/12, 2.5s, 10s)`，长句往上长窗口，不裁字
- 队列 20 条、`id+seq` 去重、坏消息只 warn 不崩
- 假 roost 与协议/气泡/退出码的单元测试
- 启动约定（可执行、参数、退出码 0/3/4/1）见 [`docs/launch.md`](docs/launch.md)

还没有的（按施工单顺序往后做）：拖拽与物理、别针与吸附、注意力、双击聊天、设置窗、宠物包渲染、打包。

## 依赖

Electron 钉死在 `43.3.0`（精确版本，不带 `^`）。这台机器的 `PATH` 里没有 node/npm，
用绝对路径叫：

```bash
NODE="C:/Users/by_ch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe"
PNPM="C:/Users/by_ch/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs"

"$NODE" "$PNPM" install
"$NODE" node_modules/electron/cli.js .
```

（`pnpm start` 也行，前提是 node 在 `PATH` 里。）

启动参数：`--size=1.2`、`--position=bottom-right|bottom-left|top-right|top-left`、
`--click-through=0`、`--pet=<包 id>`。

## Windows 上的两个平台细节

这两个不是我们的选择，是 Electron 在 Windows 上的样子，改代码时别踩回去：

- **主进程里 `process.stdin` 是空的。** GUI 子系统进程拿不到底层句柄，一挂 `data`/`end` 立刻 EOF；
  但 fd 0 本身是好的，所以 `src/main.js` 直接用 `fs.read(0, …)` 拉，再用 `LineDecoder` 切行。
- **启动时 stdout 会先多一个空行。** 读侧按协议 §1.6 跳过空行，别当成坏消息。

另外 `userData` 固定在本仓库的 `.userdata/`（`app.setPath("userData", …)`，已在 `.gitignore`）：
受限环境里 `%APPDATA%` 可能建不出来，Chromium 遇到 EPERM 会直接崩在 JS 之前。
`window.json` 就落在这里。

## 假 roost

不起 DSH，只按协议说话，专门用来单独验身体：

```bash
"$NODE" tools/fake-roost.js            # 握手 → 两条 say → 动作 → 状态 → bye
"$NODE" tools/fake-roost.js --eof      # 说完关 stdin，看它退不退得干净
"$NODE" tools/fake-roost.js --garbage  # 先灌坏消息，再发好的，看它崩不崩
"$NODE" tools/fake-roost.js --abort    # 握手前关 stdin，应该退出码 2，且不发 bye
```

`--size=1.2`、`--position=...`、`--hold=4500`（每条气泡看多久再收尾）会透传给 body。
退出码 0 表示这一轮断言全过。

## 测试

```bash
"$NODE" --test "test/*.test.js"
```

只测纯函数（协议编解码、行缓冲、气泡排程），不起 Electron。

其中一条测试会把 `docs/protocol.md` 里的两张表读出来，和 `lib/protocol.js`
逐字段、逐必填标记、逐枚举值对账——**表和代码只要有一边先改，另一边就会红。**

## 改协议

`docs/protocol.md` 是唯一来源。顺序固定：

1. 先改表；
2. 在 §9 变更记录加一行；
3. 再改两边代码（body 在 `lib/protocol.js`，roost 在它自己那边）。

roost 侧直接读仓库里这一份：<https://github.com/bychance6600/dsh-roost-pet/blob/main/docs/protocol.md>

## 推不动的时候

`.git/config` 里已经写死了这两行，这台机器推送靠它们：

```
http.proxy = http://127.0.0.1:33210     # clash 的系统代理，端口变了就改这里
credential.helper = wincred             # 凭据在 Windows 凭据管理器里
```

`push` 卡住、或者报 `could not read Username for 'https://github.com'`，先看这两行，
再确认 clash 在跑。shell 不读 Windows 的 Internet 选项，代理得显式给。

## 边界

- 不生成台词、不解释、不润色；`text` 怎么来就怎么显示。
- 只听 stdin，不监听端口，不做 IPC 服务端。
- 单实例；第二只直接退。
- 不写盘，除了 `.userdata/settings.json` 与 `.userdata/window.json` 两个小文件。
- 宠物素材不入库（`assets/` 已在 `.gitignore`）。
- MIT。
