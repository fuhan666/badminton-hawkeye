# 技术方案

采用本地运行的纯前端应用，场景渲染与视频生成均在浏览器完成。

建议技术栈：TypeScript、React、SVG、Three.js、WebCodecs 和 MP4 封装库。实现围绕球场编辑、三维回放和视频导出组织。

## 数据流

屏幕选点 → 球场坐标 → 落点圆心与归一化来球方向 → 判定与动画 → 预览或逐帧编码 → MP4。

球场尺寸、白线和接触圆共用一份几何数据。来球方向为 `(落点 - 来向点)` 的单位向量。

## 球场与判定

### 尺寸来源与测量基准

尺寸取自已核对的 BWF《Laws of Badminton》Section 4.1 现行版（In Force 26/04/2025，Version 5.0 (2)）规则 1.1、1.3、1.4、1.5、1.10 及 Diagram A：

- 规则 1.1：球场为矩形，界线宽 40 mm。
- 规则 1.3：所有线属于其所界定的区域（All the lines shall form part of the area which they define）。因此长度、宽度和各线位置一律量至**线外沿**，白线计入有效区域。
- 规则 1.4、1.5：网柱高 1.55 m，立在双打边线上，单打与双打相同，网柱及支撑不得伸入场内。
- 规则 1.10：网中央高 1.524 m，双打边线上方 1.55 m。
- Diagram A：标注总长 13.400 m、双打宽 6.100 m；半场纵向链式尺寸为 40 / 720 / 40 / 3 880 / 40 / 1 980 mm，横向为 40 / 420 / 40 / 2 530 / 40 / 2 530 / 40 / 420 / 40 mm；图注给出对角线 14.723 m，与 √(13.40² + 6.10²) = 14.723 m 一致，可作为尺寸自洽校验。

来源：

- BWF 法规目录：<https://corporate.bwfbadminton.com/statutes/>
- [现行规则及 Diagram A](<https://extranet.bwf.sport/docs/document-system/81/1466/1470/Section%204.1%20-%20Laws%20of%20Badminton%20-%2026%20April%202025%20V5.0%20%282%29%20.pdf>)

由 Diagram A 的链式尺寸可推出两处易错口径：双打后发球线靠端线一侧的边缘距端线外沿 0.76 m（40 mm 端线 + 720 mm 净空 + 40 mm 后发球线），两线之间的**净空是 0.72 m**；前发球线靠网一侧的边缘距网 1.98 m。首版只判定单打/双打完整矩形，两条发球线仅作场内参照，发球区判定不在范围内。

### 坐标约定

原点为球网与场地中线交点的地面点，x 轴沿边线方向、z 轴沿场地长轴方向、y 轴竖直向上，单位米。俯视图 +x 向右、+z 向下，网位于 z = 0。全场与局部精调共用这一米制坐标，只改变缩放系数。

### 常量清单

| 项目 | 数值 (m) | 说明 |
| --- | --- | --- |
| 场地长 / 半长 | 13.40 / 6.70 | 量至端线外沿 |
| 双打宽 / 半宽 | 6.10 / 3.05 | 量至双打边线外沿 |
| 单打宽 / 半宽 | 5.18 / 2.59 | 量至单打边线外沿 |
| 线宽 | 0.04 | 所有界线 |
| 前发球线 | 1.98 | 靠网一侧边缘距网 |
| 双打后发球线 | 0.76 | 靠端线一侧边缘距端线外沿 |
| 网柱高 / 网中央高 | 1.55 / 1.524 | 网柱沿双打边线 |
| 接触半径 | 0.013 | 模拟参数，初始建议，待样片确认 |

```ts
export const COURT = {
  length: 13.4,
  halfLength: 6.7,
  doublesWidth: 6.1,
  doublesHalfWidth: 3.05,
  singlesWidth: 5.18,
  singlesHalfWidth: 2.59,
  lineWidth: 0.04,
  shortServiceLineFromNet: 1.98,
  doublesLongServiceLineFromBackLine: 0.76,
  netPostHeight: 1.55,
  netCentreHeight: 1.524,
} as const;

export const VALID_AREA = {
  doubles: { halfWidth: 3.05, halfLength: 6.7 },
  singles: { halfWidth: 2.59, halfLength: 6.7 },
} as const;

/** 模拟接触半径，初始建议，待样片确认 */
export const CONTACT_RADIUS = 0.013;
```

### 线带

有效矩形是外沿区间，白线整条落在其中。绘制与命中检测需要的线带（正方向，负方向镜像）：

| 线 | 区间 | 中心线 |
| --- | --- | --- |
| 双打边线 | x ∈ [3.01, 3.05] | x = ±3.03 |
| 单打边线 | x ∈ [2.55, 2.59] | x = ±2.57 |
| 端线 | z ∈ [6.66, 6.70] | z = ±6.68 |
| 前发球线 | z ∈ [1.98, 2.02] | z = ±2.00 |
| 双打后发球线 | z ∈ [5.90, 5.94] | z = ±5.92 |

用居中描边绘制时必须以中心线为路径，否则白线会整体外扩 0.02 m，判定边界随之偏移。

### 判定

有效矩形 `x ∈ [-W/2, W/2]`、`z ∈ [-6.7, 6.7]`，W 取双打 6.10 或单打 5.18。对圆心 P 求矩形上的最近点 C，`|P - C|² ≤ r²` 为 IN，否则 OUT。相切算 IN；角落按到角点的距离判定，不能用「向两个轴各扩 r」的矩形替代圆角，否则四个角会误判为界内。

| 案例 | 结果 |
| --- | --- |
| P = (3.063, 0)，双打 | 最近点 (3.05, 0)，距离 0.013，相切，IN |
| P = (3.064, 0)，双打 | 距离 0.014，OUT |
| P = (3.060, 6.710)，双打角落 | 最近点 (3.05, 6.70)，距离 ≈ 0.014142，OUT |
| P = (2.70, 0) | 单打：距单打边线 0.11，OUT；双打：圆心已在有效区内，IN |
| P = (2.595, 0) | 单打：距外沿 0.005，压在单打边线上，IN；双打 IN |

比较用带容差的形式（如 `|P - C| ≤ r + 1e-9`）：`3.063 - 3.05` 在双精度下等于 `0.013000000000000012`，直接与 0.013 比较会把相切误判为出界。

SVG 负责全场选点和局部精调，两者用同一份米制数据与坐标变换保持缩放前后的落点一致；局部视图按真实比例显示接触圆与白线，全场图只放大交互手柄、不改变半径。

## 三维回放

### 确定性内核

`src/domain/replay.ts` 导出 `evaluateReplay(input, time)`，输入为既有的 `ReplayInput { format, landing, direction }`，输出是普通对象：

```ts
interface ReplayFrame {
  time: number                 // 夹到 [0, 5]
  flightProgress: number       // 0–1，触地后恒为 1
  segment: 'overview' | 'follow' | 'slowmo' | 'result'
  ball: { position: Vec3; forward: Vec3; opacity: number }
  marker: { center: Vec3; radius: number; opacity: number }
  camera: { position: Vec3; target: Vec3; fov: number }
  verdict: 'IN' | 'OUT'
  resultOpacity: number
}
```

内核不读时钟、随机数、帧率或上一帧结果，时间先夹到有效区间，因此相同输入与时刻逐字段相等。渲染层不得自行积分球路或追赶目标。

### 时间与球路

总长 5 s，触地 3.2 s。飞行进度用单调三次插值从关键帧 (0 s, 0) → (0.8 s, 0.24) → (2.0 s, 0.68) → (3.2 s, 1) 求出，前三段逐段加速、最后一段最慢，形成慢放。水平位置按进度线性推进；高度为线性下降加一项正弦抬升，抬升量按跨网处目标净高 1.9 m 解析求出，并受 6 m 上限约束。未跨网的输入不加抬升，仍可回放。

球托底端在进度 1 处直接取落点圆心，不再插值，因此 `ball.position` 在 3.2 s 之后精确等于 `(landing.x, 0, landing.z)`。朝向取曲线解析切线；触地后退化为末段方向。

### 模型原点与场景

球体局部原点是球托底端，羽毛沿纵轴向后，飞行前向为局部 +Z；姿态只改变朝向，不挪动接触原点。`src/replay/scene.ts` 只做搬运：按帧设置球体位置与朝向、镜头位姿与 FOV、印记透明度与颜色、结果牌透明度。白线用薄面几何按 `LINE` 中心线布置，外沿不偏移；球网按网柱 1.55 m、中央 1.524 m 的曲线建立网格。

### 分镜与结果

四段为 0–0.8 s 全景、0.8–2.0 s 跟随、2.0–3.6 s 慢放触地、3.6–5.0 s 印记定格。相机关键帧在段边界完全共享，段间用三次 Hermite 过渡，位置、视点与 FOV 连续；跟随段采用相对球体固定的机位，整段构图稳定。

慢放段在 3.2 s 触地时刻就到达近景构图，此后到 5 s 只做约 5% 的前推。近景机位按落点解析求出，不写死：先取落点需要交代的参照线——压边线取该条边线、压角取相交的两条边线、离边界超过 1.2 m 时取落点前方最近的一条场内白线——再以「线带 + 落点」为构图点，从近到远找能把它们全部收进画面安全区的最小距离。视线以边界法线为主、沿边界线带约 25° 斜角；机位仍在落点这一侧的场地内，画面下方是球场、上方是场外，避免暗色区域占满近景。机位高度随距离抬升，形成 55°–70° 的俯角。机位不越过球网；跟随段到近景之间若确实要过网，会插入一个抬高的过网关键帧。

结果牌用 CanvasTexture 绘制并挂在相机下方，随 FOV 换算尺寸，保证与画面同屏且能随帧导出。圆形印记半径取 `CONTACT_RADIUS`，抬到白线之上 2 mm，重叠时不会被白线遮住，也不放大判定圆。

## 视频导出

### 封装选型

| 库 | 版本 | 许可证 | 维护状态 | 解包体积 |
| --- | --- | --- | --- | --- |
| Mediabunny | 1.66.0 | MPL-2.0 | 活跃（2026-11-13 更新） | 11,874,123 B |
| mp4box | 2.5.0 | BSD-3-Clause | 活跃（2026-10-25 更新） | 2,485,275 B |
| mp4-muxer | 5.2.2 | MIT | 已弃用，官方指向 Mediabunny（2025-07-02 后无更新） | 155,878 B |

选定 **Mediabunny 1.66.0**，只用它的 MP4 封装能力（`Output`、`Mp4OutputFormat`、`BufferTarget`、`EncodedVideoPacketSource`、`EncodedPacket`），视频编码直接调原生 `VideoEncoder`，便于拿到真实配置和错误。mp4box 的 BSD 许可更宽松，但要自己拼 AVC track 与 sample 描述，接入成本明显更高；mp4-muxer 接入最简单，但已被官方弃用，不适合作为新代码的基础。

MPL-2.0 是文件级弱 copyleft：本项目只通过 npm 引用未修改的包，不修改其源码，因此不要求本项目整体改用 MPL，项目自身的开源许可证仍由项目所有者决定。分发时保留该依赖的许可证声明与来源即可。体积一栏是 npm 解包大小，不代表浏览器产物。

只导入上述五个导出的实际体积为 **129,305 B（minified）/ 34,782 B（gzip）**，测量方式：`esbuild --bundle --minify --format=esm --target=es2022` 打包一个仅导入这五个符号的入口。

正式导出接入后，`mediabunny` 已从 `devDependencies` 移到运行时 `dependencies`，只导入 `Output`、`Mp4OutputFormat`、`BufferTarget`、`EncodedVideoPacketSource`、`EncodedPacket`。生产入口 JS 由 787,519 B 增至 925,122 B（+137,603 B，+17.5%），gzip 由 212,025 B 增至 250,347 B（+38,322 B，+18.1%）；CSS 由 6,022 B 增至 6,863 B（gzip 1,917 B → 2,094 B）。体积以 `npm run build` 产物为准。

### 编码参数

固定 1920×1080 / 30 fps / 5 s / 150 帧 / 无音轨，与 PRD 建议一致：

- 编码 `avc1.420028`（H.264 Baseline，Level 4.0），码率 8 Mbps，`avc: { format: 'avc' }`，每 30 帧一个关键帧（共 5 个）。
- 采样 `t = 帧序号 / 帧率`，只编 `i = 0…149`，不再编 `t = 5 s` 的第 151 帧；第 `i` 帧 `timestamp = round(i × 10⁶ / 30)`，`duration` 取相邻边界之差，首帧 0 µs、末帧结束 5,000,000 µs。
- 画布渲染像素比固定为 1（`createReplayScene(canvas, { pixelRatio: 1 })`），否则设备 DPR 会把画布放大成非目标尺寸。

### 实现要点

`render` 之后立刻用同一 canvas 构造 `VideoFrame`，避免绘制缓冲被清空；编码回调里把 `EncodedVideoChunk` 转成 `EncodedPacket` 后按序串行 `await source.add(packet, meta)`，首包必须带编码器给的 `decoderConfig`，否则 MP4 缺 `avcC`；`encoder.flush()` 只保证编码结束，之后还要等写入链完成，再 `source.close()` 与 `output.finalize()`；编码错误与封装错误分别记录并冒泡，不能只等 flush 就判定成功；`encodeQueueSize` 超过 8 时等 `dequeue` 事件做背压。

### 实测结果

验证工具在 `tools/mp4-probe`，命令见 README。固定双打输入：落点 `(3.055, 3.2)`、来向点 `(3.055, 0)`，即单位方向 `(0, 1)`。

| 项目 | 结果 |
| --- | --- |
| 分辨率 | 1920×1080 |
| 帧率 | 30 fps（ffprobe `avg_frame_rate = 30/1`） |
| 帧数 | 150 |
| 时长 | 5.000 s（时间戳 0 → 5,000,000 µs） |
| 文件大小 | 1,815,323 B |
| 轨道 | 仅一条视频轨，H.264 Baseline，无音轨 |
| 渲染 + 编码耗时 | 约 0.9 s（Chrome 914 ms、Edge 901 ms，随机器波动） |
| 封装耗时 | 3–5 ms |

播放验证：原生 `<video>` 读回 1920×1080、时长 5.000 s；播放 1.2 s 后 `currentTime = 1.201 s`；跳转到 3.2 s 后 `currentTime = 3.2 s`，该帧与 4.6 s 定格帧均非黑屏，13 mm 印记压在双打边线上、画面下方 IN 结果牌可读。

运行环境（2026-11-16 实测，`--headless=new`，无头模式使用 ANGLE Metal 渲染）：

- macOS 27.0.1（Darwin 27.0.0，Apple M1 Pro），Node 24.13.0。
- Chrome 157.0.8103.51：`VideoEncoder` / `VideoFrame` / WebGL 均可用，`isConfigSupported` 对 1080p30 `avc1.420028`、`avc1.640028`、`avc1.4d0028` 与 720p30 `avc1.42001f` 全部返回 `true`。
- Edge 153.0.4234.48：同样全部返回 `true`，并生成相同参数的可播放文件。

失败路径实测：编码字符串不存在时（`avc1.ffffff`）`isConfigSupported` 返回 `supported: false`，不抛异常；HEVC（`hvc1.1.6.L93.B0`）在 Chrome 157 返回 `true`、Edge 153 返回 `false`。因此导出固定使用 H.264，能力判断一律以 `isConfigSupported` 的结果为准，不能按浏览器品牌推断；不支持时提示当前浏览器缺少 H.264 编码能力。

### 导出流程

实现位于 `src/export/exportReplay.ts`（编码、封装、清理）与 `src/export/useExportJob.ts`（单任务、进度、下载）。

1. 点击导出时复制赛制、落点与单位方向作为快照，之后继续编辑不改变本次视频；同时只允许一个活动任务。
2. 能力判断：`VideoEncoder` / `VideoFrame` 缺失，或 `isConfigSupported` 对完整 1080p30 配置返回 false / 拒绝，都给出“当前环境不支持视频导出”的可见提示，预览照常。
3. 独立画布 1920×1080 + `createReplayScene(canvas, { pixelRatio: 1 })`，不抓取预览画布；按 `t = i / 30` 调 `evaluateReplay` 渲染 150 帧。
4. 每帧构造 `VideoFrame` 后立即编码并关闭；`keyFrame` 取 `i % 30 === 0`。`encodeQueueSize > 8` 时等待 `dequeue` 背压，每 5 帧让出一次事件循环。
5. 进度按编码回调确认的帧数换算 0–100%，界面区分准备、编码、封装、收尾；封装完成前不宣告成功。
6. 取消通过 `AbortController` 在每次送帧、背压等待、flush 后、写入链后、finalize 前检查；取消后立即停止送帧，关闭编码器并 `output.cancel()` 丢弃半成品，不建立下载。编码或封装错误同样冒泡，不能被 flush 成功掩盖。
7. 成功路径：`flush()` → 等写入链 → `source.close()` → `output.finalize()` → 取 `BufferTarget` 生成 Blob → 自动下载带落点与时间戳的文件名；下载 URL 在使用后撤销。
8. 成功、失败、取消与组件卸载都进入统一清理：关闭 `VideoEncoder`、取消未完成的封装、`scene.dispose()` 并清空画布与缓冲引用。

单元测试在 `src/export/exportReplay.test.ts`，用假后端覆盖帧时间轴、进度换算、输入快照、150 帧送帧与关键帧位置、背压期间取消、取消后重试、编码/封装错误和不支持提示。正式界面路径由 `tools/export-smoke` 在真实浏览器中覆盖成功、取消、重试、OUT 结果与不支持提示。


## 验证与交付

重点测试圆与矩形相交、相切、角落、赛制切换、坐标转换和方向一致性。用代表性样片检查构图与触地效果，实际播放导出文件验证时长和画面。

项目 README 提供安装、启动、构建和使用步骤，记录实际验证的浏览器环境。依赖与素材适合开源分发；开源许可证由项目所有者确定。
