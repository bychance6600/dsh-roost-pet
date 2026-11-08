# dsh-roost-pet

roost 的身体。

一只没有对话框、没有按钮、没有台词的小窗：透明、置顶、默认不吃点击。
它不生成任何字——roost 说什么，它就把那句话原样冒出来；roost 不说，它就安静待着。

- 需求准绳：`dsh-roost/docs/dsh-pet-给roost设计.md`
- 施工单：`dsh-roost/docs/dsh-pet-施工单-body侧.md`
- 协议表：**[docs/protocol.md](docs/protocol.md)**（唯一来源，两边都照它写）

## 现在到哪一步

第 1 步（透明窗口 + 协议 v1 + 冒泡）已过；现在做到了第 5 步：五档姿态 + 宠物包渲染 + 底噪切换。

已经有的：

- 透明、无边框、置顶、跳过任务栏的小窗（360×420，上面 120px 留给气泡，下面 300px 给身体）
- 默认整窗穿透；指针压到身体上才收点击（`setIgnoreMouseEvents(true, { forward: true })` + IPC 切换）
- 协议 v1 的握手、`say` 冒泡、`state` 只读显示、`act` 收下、`bye` / stdin EOF / 关窗退出
- 气泡时长 `clamp(字数/12, 2.5s, 10s)`，长句往上长窗口，不裁字
- 队列 20 条、`id+seq` 去重、坏消息只 warn 不崩
- 五档姿态（thinking / acting / waiting / error / done），done 与 error 只改姿态和只读标签，2–5 秒自己回 waiting
- 宠物包：`pet.json` + 图片/webm 帧序列，按 §9 的回退链（`actions.x → click → turn → breathing`）；坏包只 warn 并退回占位团子
- `act` 的 nod/shake/bounce/shy/laugh/stretch/sleep/wake/quiet/loud 有 CSS 骨架；sleep 走 start → loop → end
- 底噪切换：呼吸以外，张望 / 打盹 / 伸懒腰每 3–5 分钟换一次（睡、说话、有档位在身时不换）；`quiet` 停换、`loud` 恢复
- 假 roost 与协议/气泡/宠物包/退出码的单元测试
- 启动约定（可执行、参数、退出码 0/1/2/3/4）见 [`docs/launch.md`](docs/launch.md)

还没有的（按施工单顺序往后做）：别针与吸附、注意力、双击聊天、设置窗、失败演练与打包。

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

启动参数：`--size=1.2`、`--position=bottom-right|bottom-left|top-right|top-left|center`、
`--click-through=0`、`--pet=<包 id>`、`--pet-dir=<目录>`（调试用：直接指一个包目录）。

## 宠物包

素材不入库，所以仓库里没有 `pets/`。摆一个包进去就能看：

```
pets/
  my-pet/
    pet.json
    breathing-1.png  breathing-2.png
    nod.webm
```

```json
{
  "id": "my-pet",
  "name": "我的宠物",
  "size": 1,
  "animations": {
    "breathing": ["breathing-1.png", "breathing-2.png"],
    "look": ["breathing-2.png"],
    "click": ["nod.webm"],
    "turn": { "left": ["look-left.webm"], "right": ["look-right.webm"] },
    "states": { "thinking": ["think.webm"], "acting": ["act.webm"] },
    "sleep": { "start": ["s1.webm"], "loop": ["s2.webm"], "end": ["s3.webm"] },
    "actions": { "nod": ["nod.webm"], "shake": ["shake.webm"] }
  }
}
```

- 一组是一串文件：图片按 110ms 一帧播，`webm`/`mp4` 按片长播；`breathing` 一直循环。
- 动作可以只播一段：`"nod": { "file": "nod.webm", "from": 2.0, "to": 6.4 }`（秒，`from`/`to` 可省）。播到 `to` 就停、淡出 0.15 秒，然后回当前档位；不写窗口就整段播。
- 缺组按 `actions.x → click → turn.left → breathing` 回退；`states.thinking/acting` 没配就按
  `states.x → look → turn.left → breathing` 回退，再缺就画占位团子（一个白团子两只眼）。
- 路径只许留在包目录里；文件不存在、数组为空、`pet.json` 坏了，都会在 stderr 和 `log` 里说明，并退回占位。
- 没有包也能跑：`"$NODE" node_modules/electron/cli.js .` 就是占位团子。
- `--pet-dir` 显式指了坏目录 → 退出码 4（配置错）；默认位置缺包不算错。
- 换包不重启还没做（施工单 §9 的要求）。

## 交互（第 1 步之后补的）

- 单击身体：播包里 `click` 的一段（没包就轻跳一下），同时发 `poke`（窗口内 CSS 像素）；不出声。
- 拖拽：按住身体拖动窗口；松手后窗口就停在拖到的位置（重力/抛掷是施工单 §7 后续步骤）。
- 睡着时也能拖，拖完回到睡姿。

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
