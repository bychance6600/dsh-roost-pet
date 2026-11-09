# dsh-roost-pet

**roost 的可选身体。** 一只透明、置顶、默认点不到的小窗：她说什么，它就把那句话原样冒出来；她做什么，它就演什么。它不生成任何字，不联网，不接模型。

主线在 [dsh-roost](https://github.com/bychance6600/dsh-roost)。这一版是身体，不是人格。

## 它做什么

| 做 | 不做 |
| --- | --- |
| 气泡显示 roost 递来的原话 | 生成文字、语音 |
| 五档姿态：思考 / 动手 / 等 / 成了 / 出错 | 自己的模型、记忆、人设 |
| 按角色包播动作，可以只播一段窗口 | 自动打招呼、碎碎念 |
| 拖拽、抛掷、落地挤压 | 联网、上报 |
| 单击把「被戳了」转达给 roost | 点击必有反应——回不回由她定 |
| 睡醒跟着 roost 的状态走 | 自己的作息 |

## 需要

- Windows 10 / 11 x64
- DSH + [dsh-roost](https://github.com/bychance6600/dsh-roost) 0.1.0 以上（说什么、什么时候睡，都由 roost 决定）
- 一个角色包（本仓库不含素材，见下文）

## 装

1. 从 [Releases](https://github.com/bychance6600/dsh-roost-pet/releases) 下载 `dsh-roost-pet-v0.1.2-win32-x64.zip`，解压到：

   ```
   C:\Users\<你>\.dsh-roost\pet\
   ```

   解压后应当是 `...\pet\dsh-roost-pet.exe`。

2. 打开 roost 的 `C:\Users\<你>\.dsh-roost\config.json`，加一段：

   ```json
   "pet": {
     "enabled": true,
     "path": "C:/Users/<你>/.dsh-roost/pet/dsh-roost-pet.exe",
     "pack": "default"
   }
   ```

3. 重启 DSH。roost 会把它拉起来；日志里出现 `桌宠已连上：default` 就成了。

> 不想用了：`enabled` 改回 `false` 再重启。删干净＝删掉 `~/.dsh-roost/pet` 和配置里这三行。

## 角色包

放在 `C:\Users\<你>\.dsh-roost\pets\<id>\`，一个 `pet.json` 加一组素材（`.webm` 或图片帧序列）。

```json
{
  "id": "default",
  "name": "随便起",
  "size": 1.5,
  "animations": {
    "breathing": ["待机呼吸.webm"],
    "drag": ["被拖拽.webm"],
    "click": ["点击回应.webm"],
    "look": ["东张西望.webm"],
    "sleep": { "start": ["睡下.webm"], "loop": ["睡着.webm"], "end": ["起来.webm"] },
    "actions": {
      "nod": [{ "file": "点头.webm", "from": 2, "to": 6.4 }],
      "wave": [{ "file": "挥手.webm", "from": 0, "to": 3 }]
    },
    "states": {
      "thinking": ["思考.webm"],
      "acting": ["动手.webm"],
      "waiting": ["等待.webm"],
      "done": ["成了.webm"],
      "error": ["出错.webm"]
    }
  }
}
```

- `actions` 里的名字随便起。roost 启动时读这个 `pet.json`，她手上能用哪些动作由包决定
- `from` / `to` 是秒，只播这一段；不写就整段播
- 缺的组走回退链：`actions.x → click → turn → breathing`
- 没有包时显示一个占位团子，协议照常可用

## 素材

本仓库**不含任何角色素材**。素材版权归原作者（`CC BY-NC-SA`，非商用）；想用现成的，去 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的 `assets/webm` 里挑，或者自己画、自己生成。

## 协议

[`docs/protocol.md`](docs/protocol.md) 是唯一来源：JSONL over stdin/stdout，握手 / `say` / `state` / `act` / `poke` / `bye`。别的宿主想接这只身体，照它实现即可。

## 开发

```bash
pnpm install
pnpm start                        # 直接开窗口
pnpm test                         # node --test
node scripts/build-portable.js    # 出 dist/*.zip
```

`tools/fake-roost.js` 可以假装 roost 推消息。启动参数与已知的坑见 [`docs/launch.md`](docs/launch.md)。

## 限制

- 只支持 Windows；macOS / Linux 要自己适配（Electron 跨平台，但窗口与穿透逻辑得重写）
- 没有自动更新、没有托盘、没有开机自启
- 单实例：已经有一只时再启动，会以退出码 3 退出

## 来源与许可

代码 MIT。窗口、协议和打包思路源自 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT，PC2005-cloud），改了什么见 [`NOTICE`](NOTICE)。角色素材不属于本项目。
