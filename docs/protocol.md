# dsh-roost-pet 私有通道协议 v1

- 状态：v1 定稿，2026-11-08
- **本文件是协议表的唯一来源。** body 侧（本仓库）与 roost 侧都以它为准；`dsh-roost/docs/dsh-pet-施工单-body侧.md` §3 只作指向，不另维护第二份表。
- 改字段的规矩：**先改这里的表 → 在 §9 变更记录加一行 → 再改两边代码。** 两边字段集合不一致会被 `test/protocol.test.js` 的断言卡住。
- 表里没有的消息类型和字段一律不实现。

---

## 1. 传输

1.1 roost `spawn` body，`stdio: ['pipe','pipe','pipe']`。body 的 **stdin 是唯一输入**。
1.2 stdout 只走协议：一行一个 JSON 对象，UTF-8，`\n` 结尾，行内不含裸换行。所有日志、报错、调试输出走 **stderr**。
1.3 单行上限 **16 KB**（JSON 本身，不含换行）。超了不截断，拆成多条消息（`say` 分条见 §4.5）。
1.4 读侧按行聚合：只有读到 `\n` 才算一条；粘包、半包都按行切；半行缓冲区不解析。
1.5 容错——读侧任何情况下都不崩：
   - 坏 JSON → 丢弃该行，`log {level:"warn"}`；
   - 未知 `t` → 忽略，`log {level:"warn", msg:"unknown t=<x>"}`；
   - 多余字段 → 忽略；
   - 缺必需字段、字段类型不对 → 丢弃该条，`log {level:"warn"}`。
1.6 空行（长度为 0 的行，含只有 CR 的行）直接跳过，不当消息、不 warn。
1.7 双向对称：1.5 对 roost 读 body 的输出同样成立。

## 2. 握手

2.1 body 启动后 **3 秒内**发 `hello`；握手完成前 body 只发 `hello` 这一种消息。
2.2 roost 收到后回 `hello`，握手完成。
2.3 roost 侧 10 秒未握手：杀进程，退避重试（策略在 roost 侧，body 不自己重启）。
2.4 `v ≠ 1`：写 stderr，仍按 v1 尽力处理，**不退出**——版本协商留给人。

## 3. roost → body

| t | 字段 | 必填 | body 要做什么 |
| --- | --- | --- | --- |
| `hello` | `v:number`, `roost:string` | 是 | 握手回包，`v=1` |
| `say` | `id:string`, `seq:int≥0`, `text:string`, `final:bool` | 是 | 把这句**逐字**冒泡。`text` 不加工、不截断、不概括；`seq` 是同一轮内分条序号；`final=true` 表示该轮没有后续分条了 |
| `state` | `state:enum`, `why:string` | 是 | 五档姿态：`thinking`/`acting`/`waiting`/`error`/`done`。`why` 是人话依据，可为空串（例：`等：等会话返回`）。**只改姿态与只读显示，不冒泡** |
| `act` | `action:enum`, `why:string` | 是 | 演一个动作；`why` 同上。`quiet` 不是隐藏，`sleep`/`wake` 管睡与醒 |
| `bye` | —（无字段） | — | 正常退出；body 3 秒内退干净 |

枚举（表外值一律按"未知"忽略并 warn）：

- `state` ∈ `thinking` | `acting` | `waiting` | `error` | `done`
- `action` ∈ `nod` | `shake` | `bounce` | `shy` | `laugh` | `stretch` | `sleep` | `wake` | `quiet` | `loud`

## 4. body → roost

| t | 字段 | 必填 | 什么时候发 |
| --- | --- | --- | --- |
| `hello` | `v:number`, `body:string`, `pet:string` | 是 | 启动即发；`v=1`；`body` 形如 `dsh-roost-pet/0.1.0`；`pet` 是当前宠物包 id |
| `input` | `id:string`, `text:string` | 是 | 聊天框按 Enter 时发**原文**：不 trim、不补标点、不转义、不加"正在输入" |
| `poke` | `x:number`, `y:number` | 是 | 点击身体时发；**窗口内 CSS 像素，原点为窗口左上**（见 §9 澄清） |
| `ack` | `id:string` | 是 | 收到 `say` 且已入队（§6） |
| `log` | `level:enum`, `msg:string` | 是 | 需要 roost 记一笔的异常 |
| `bye` | —（无字段） | — | 退出前尽力发一次 |

枚举：`level` ∈ `debug` | `info` | `warn` | `error`。

## 5. 冒泡规则

5.1 一条 `say` 一个气泡。
5.2 同 `id` 同 `seq` 只显示一次（去重键是 `id + seq`；同一轮的多条 `say` 共用 `id`、靠 `seq` 区分，见 5.3）：重复到达直接丢弃，但仍回 `ack`（§6.1）。
5.3 顺序：同一 `id` 的分条按 `seq` 升序；跨 `id` 按到达先后。乱序到达时插进正确位置，不重排已显示过的。
5.4 显示时长 = `clamp(字数 / 12, 2.5s, 10s)`：按 12 字/秒估算，最少 2.5 秒、最多 10 秒。文字本身不截断；气泡放不下就把窗口往上长，不从窗口边缘裁掉。
5.5 单条最早替换间隔 **1.2 秒**（下限保护：即使 5.4 的时长被设置改小，也不快于 1.2s）。
5.6 队列上限 **20** 条；满了丢弃最新到达的那条并 `log {level:"warn"}`（同类合并，不刷屏）。
5.7 没有 `say` 就绝不冒字；`state`/`act` 不产生气泡。
5.8 `final=true` 只是标记，不触发额外行为（body 不据此清空队列、不据此收尾气泡）。

## 6. ack 与背压

6.1 收到 `say`：先校验字段 → **立刻** `ack{id}` → 再入队。队列满导致的丢弃发生在入队时，`ack` 照发（roost 因此知道"我发到了，是它排不下"）。
6.2 `ack` 只回 `id`，不带状态码；失败信息只走 `log`。
6.3 body 不做重连、不做重放；丢了的 `say` 由 roost 决定是否重发，重发同 `id` 会被 5.2 去重。

## 7. 生命周期

7.1 退出触发：收到 `bye`、窗口关闭、stdin EOF。任一发生 → 3 秒内退干净（进程、窗口、托盘都不留）。
7.2 body 退出前尽力发 `bye` 并 flush stdout，然后关窗口。
7.3 崩溃不自动重启；roost 按退避重试。
7.4 单实例：`app.requestSingleInstanceLock()`；第二只直接退出，stderr 写清原因。
7.5 不监听端口、不开 HTTP/WebSocket、不做 IPC 服务端；不读 DSH 数据目录。除 `settings.json`、`window.json` 两个本地小文件外不写盘。

## 8. 版本

8.1 当前 `v=1`。
8.2 新增**可选**字段：先进本表 + 记变更，不升 `v`；但读侧必须忽略不认识的字段（§1.5）。
8.3 删字段、改语义、改必填性：升 `v=2`，并在变更记录写清迁移方式。
8.4 消息类型只增不减；废弃的类型保留为 no-op，不静默改义。

## 9. 变更记录

| 日期 | 版本 | 变更 | 改的人 |
| --- | --- | --- | --- |
| 2026-11-08 | v1 | 显示时长由 `max(8s, 字数/12)` 改为 `clamp(字数/12, 2.5s, 10s)`；1.2 秒最早替换间隔不变；补一句"气泡放不下就往上长，不裁字" | body |
| 2026-11-08 | v1 | 澄清 §5.2：去重键是 `id + seq`，不是单独的 `id`——否则 §5.3 的同轮分条会全被当成重复丢掉 | body |
| 2026-11-08 | v1 | 补 §1.6：空行忽略。Electron 在 Windows 启动时会先往 stdout 甩一个空行，读侧不能当成坏消息 | body |
| 2026-11-08 | v1 | 从施工单 §3 抽出成独立表；澄清 `poke.x/y` 为窗口内 CSS 像素；补齐容错（坏 JSON/未知 t/缺字段）、重复 `id` 去重、`final` 语义、队列满与 `ack` 的先后、行缓冲上限 | body |

## 10. 附录：一轮完整示例

```jsonc
// body 启动
{"t":"hello","v":1,"body":"dsh-roost-pet/0.1.0","pet":"default"}
// roost 回
{"t":"hello","v":1,"roost":"0.1.0"}

// 她开始思考
{"t":"state","state":"thinking","why":"思考：模型回合中"}

// 她说了一句，分两条，带动作
{"t":"say","id":"s1","seq":0,"text":"在翻今天推来的几条。","final":false}
{"t":"say","id":"s1","seq":1,"text":"有一条挺有意思，等我念给你听。","final":true}
{"t":"act","action":"nod","why":"她点头"}

// body 每条 say 立刻 ack
{"t":"ack","id":"s1"}

// 她回到等待
{"t":"state","state":"waiting","why":"等：她醒着，没在做事"}

// 主人双击输入条敲了一句
{"t":"input","id":"u1","text":"你在干嘛"}

// roost 要退
{"t":"bye"}
```
