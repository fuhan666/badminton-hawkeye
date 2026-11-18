# 技术方案

TypeScript、React 和 Vite 构成应用；SVG 负责球场编辑，Three.js 负责回放，WebCodecs 编码视频，Mediabunny 封装 MP4。

## 模块与数据流

| 入口 | 职责 |
| --- | --- |
| [App.tsx](../src/App.tsx) | 赛制、选点、配置状态与导出调用 |
| [domain/](../src/domain/) | 球场几何、判定、坐标、方向与回放计算 |
| [components/](../src/components/) | SVG 编辑器、设置控件、预览与进度界面 |
| [replay/scene.ts](../src/replay/scene.ts) | 三维场景、材质、结果牌和资源释放 |
| [export/](../src/export/) | 导出参数、编码、封装、任务状态与下载 |
| [settings/](../src/settings/) | 浏览器配置校验、读取与保存 |

选点从屏幕坐标转换为米制坐标，再生成落点、判定和单位来球方向。回放计算接收选点、时间与宽高比，预览和导出共用计算结果及场景实现。配色由 App 传给 SVG、CSS、三维场景和导出任务。

## 球场几何

尺寸依据 BWF《Laws of Badminton》2025-04-26 版的规则 1.1、1.3–1.5、1.10 与 Diagram A。规则来源：[法规目录](https://corporate.bwfbadminton.com/statutes/)、[规则文件](https://extranet.bwf.sport/docs/document-system/81/1466/1470/Section%204.1%20-%20Laws%20of%20Badminton%20-%2026%20April%202025%20V5.0%20%282%29%20.pdf)。

原点为球网与中线交点的地面位置。X 沿球场宽度，Z 沿球场长度，Y 竖直向上；俯视图 +X 向右、+Z 向下，球网位于 Z = 0。数据单位为米，尺寸量至场线外沿，场线计入有效区域。

常量定义于 [court.ts](../src/domain/court.ts)：

| 项目 | 数值 |
| --- | --- |
| 场地长／半长 | 13.40／6.70 m |
| 双打宽／半宽 | 6.10／3.05 m |
| 单打宽／半宽 | 5.18／2.59 m |
| 线宽 | 0.04 m |
| 前发球线靠网边缘距网 | 1.98 m |
| 双打后发球线靠端线边缘距端线外沿 | 0.76 m |
| 网柱高／网中央高 | 1.55／1.524 m |
| 接触半径 | 0.013 m，模拟参数 |

场线按中心线绘制，正方向线带如下，负方向镜像：

| 场线 | 线带区间（m） | 中心线（m） |
| --- | --- | --- |
| 双打边线 | X ∈ [3.01, 3.05] | X = 3.03 |
| 单打边线 | X ∈ [2.55, 2.59] | X = 2.57 |
| 端线 | Z ∈ [6.66, 6.70] | Z = 6.68 |
| 前发球线 | Z ∈ [1.98, 2.02] | Z = 2.00 |
| 双打后发球线 | Z ∈ [5.90, 5.94] | Z = 5.92 |

双打端线与后发球线之间的净空为 0.72 m。居中描边必须使用中心线位置，以保持白线外沿与判定边界一致。

[viewport.ts](../src/domain/viewport.ts) 定义全场窗口及局部 0.24×0.17 m 窗口。[CourtView](../src/components/CourtView.tsx) 将指针坐标映射到 SVG 米制坐标，局部拖动期间固定视窗以避免重居中跳动；手柄尺寸与接触半径分别绘制。[editing.ts](../src/domain/editing.ts) 负责 1 mm／10 mm 键盘微调及范围限制。

## 判定与方向

[judgement.ts](../src/domain/judgement.ts) 对圆心 P 求有效矩形上的最近点 C，以 `distance(P, C) <= CONTACT_RADIUS + 1e-9` 判 IN，否则判 OUT。角落使用到角点的欧氏距离，容差单位为米。

有效矩形为 `X ∈ [-W/2, W/2]`、`Z ∈ [-6.7, 6.7]`，W 由赛制决定。双打落点 `(3.063, 0)` 与外沿相切判 IN，`(3.064, 0)` 判 OUT；角落 `(3.060, 6.710)` 到边界距离约 0.014142 m，判 OUT。

[direction.ts](../src/domain/direction.ts) 生成 `normalize(landing - incoming)`。来向点缺失或两点距离小于 0.01 m 时返回无效方向；有效时生成 `ReplayInput { format, landing, direction }`。回放输入只保留单位方向，因此沿同一射线调整来向点距离会得到相同回放。

## 三维回放

[replay.ts](../src/domain/replay.ts) 的 `evaluateReplay(input, time, aspect)` 根据输入、绝对时刻和宽高比返回球体、镜头、印记与判定状态。同一组输入得到相同结果，时间限制在 0–5 秒。

分镜为 0–0.8 秒全景、0.8–2.0 秒跟随、2.0–3.6 秒慢放、3.6–5.0 秒定格，触地时刻为 3.2 秒。球体原点位于球托底端，触地后直接取 `(landing.x, 0, landing.z)`；印记半径始终取 `CONTACT_RADIUS`。

球路由关键时刻的飞行进度求值，朝向取轨迹切线。跨网轨迹计算抬升高度；相机关键帧用 Hermite 插值衔接。近景根据落点选择参照线，再依据宽高比求机位距离；全景与跟随机位适配窄画幅。具体构图参数由 `replay.ts` 维护。

[scene.ts](../src/replay/scene.ts) 将回放状态应用到球体、相机、印记和结果牌。印记置于白线之上以显示重叠关系；结果牌挂在相机下方，尺寸同时受横向和纵向画幅约束。

[ReplayPreview](../src/components/ReplayPreview.tsx) 用 `requestAnimationFrame` 换算播放时刻，拖动时间轴时暂停。赛制或选点变化后回零；换色和改变画幅保留播放位置。预览按目标比例缩放，高度上限为 480 px。

## 视频导出

[exportSettings.ts](../src/export/exportSettings.ts) 定义尺寸预设、帧率、默认值及编码参数；可选规格见[产品需求](PRD.md#导出与配色)。

- 宽高为正偶数，帧率为 24、25、30、50 或 60 fps。
- H.264 Baseline level 按宏块数、宏块率、单边宏块限制和码率选择；完整配置交给 `VideoEncoder.isConfigSupported` 检查。
- 码率以 1920×1080、30 fps 的 8 Mbps 为基准，按像素数与帧率同比例计算；每秒一个关键帧。
- 总帧数为 `5 × fps`。第 i 帧在 `i / fps` 采样，时间戳为 `round(i × 1_000_000 / fps)` 微秒，时长取相邻边界之差，末帧结束于 5,000,000 微秒。

[exportReplay.ts](../src/export/exportReplay.ts) 执行编码和封装，[useExportJob.ts](../src/export/useExportJob.ts) 管理单个活动任务、进度、取消与下载：

1. 复制赛制、落点、单位方向、完整色板和视频参数，作为本次任务快照。
2. 检查浏览器编码能力；创建独立画布与场景，以 `pixelRatio: 1` 按目标尺寸渲染，并检查设备尺寸限制。
3. 每帧调用 `evaluateReplay(input, i / fps, width / height)`，渲染后立即构造 `VideoFrame`，送入编码器后关闭该帧。
4. 编码输出通过 Mediabunny 的 `EncodedVideoPacketSource` 串行写入 MP4。首包的 `decoderConfig` 随包传入，编码与封装错误传回任务。
5. 编码队列超过 8 帧时等待 `dequeue`，每 5 帧让出事件循环。进度按编码回调确认的帧数计算，界面统一显示「导出中」。
6. 完成时依次执行 `flush()`、等待写入链、`source.close()`、`output.finalize()`，再生成 Blob 并下载。100% 编码进度与封装完成分别处理。
7. 取消通过 `AbortController` 停止送帧、丢弃未完成封装；成功、失败和取消均释放编码器与场景。下载 URL 使用后撤销。

文件名由 `buildExportFilename` 生成，包含赛制、落点、宽高、帧率和本地时间。导出期间的编辑只影响界面及后续任务。

## 配色与设置保存

[courtColors.ts](../src/courtColors.ts) 定义三套预设、完整色板及八个可编辑字段。预设保留二维与三维各自的显示色值；自定义同一用途时同步更新对应字段。`setPalette` 更新材质、背景、雾、印记与结果牌纹理，替换后释放旧纹理，保留场景和播放状态。

[ExportSettings](../src/components/ExportSettings.tsx) 的预设和帧率选择直接生效，自定义宽高通过「应用」提交，并校验数值及 H.264 范围。[PaletteSettings](../src/components/PaletteSettings.tsx) 提供颜色选择器和六位 HEX 输入；HEX 在失焦或按 Enter 后提交有效值。

[appSettings.ts](../src/settings/appSettings.ts) 定义 `AppSettings`，以 `badminton-hawkeye.settings` 为 localStorage 键，记录导出参数、配色模式和自定义色板。[useAppSettings](../src/settings/useAppSettings.ts) 在启动时读取、变更后保存。

首次使用、读取失败或数据损坏时采用默认配置；存储可写时保存当前合法设置，覆盖损坏记录。存储不可写时，配置在当前页面生效。

## 验证工具

| 命令 | 覆盖范围 |
| --- | --- |
| `npm test` | 几何、坐标、方向、回放、编码参数、任务生命周期及设置保存 |
| `npm run build` | 类型检查与生产构建 |
| `npm run probe:typecheck` | MP4 验证工具的独立类型检查 |
| `npm run probe -- --browser chrome` | 固定输入的渲染、编码、封装与播放验证 |
| `npm run smoke:export -- --browser chrome` | 正式界面的选点、判定、导出、取消、重试与不支持提示 |
| `npm run smoke:export -- --browser chrome --server preview` | 生产构建的同一路径，运行前先执行 `npm run build` |

`tools/mp4-probe/run-probe.mjs` 和 `tools/export-smoke/run-export-smoke.mjs` 使用 macOS 的 Chrome／Edge 路径，启动独立无头浏览器与 Vite。`--browser edge` 选择 Edge，`--port` 修改端口；默认分别为 5199 和 5201。

每次运行会重建各自的 `out/` 目录，输出报告、截图和视频。该目录被 Git 忽略，需保留的验收结果写入[验收记录](ACCEPTANCE.md)，样片存入 `docs/media/`。
