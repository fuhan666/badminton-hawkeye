# 第三方依赖与素材说明

本项目为纯前端应用，运行时不访问网络。构建产物 `dist/` 会把下列直接依赖打进 bundle 或作为工具链使用。版本以 `package-lock.json` 为准，安装 `npm ci` 后与下表一致。

## 运行时依赖

| 包 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| [mediabunny](https://mediabunny.dev/) | 1.66.0 | MPL-2.0 | MP4 封装：`Output` / `Mp4OutputFormat` / `BufferTarget` |
| [react](https://react.dev/) | 19.3.1 | MIT | 界面渲染 |
| [react-dom](https://react.dev/) | 19.3.1 | MIT | 浏览器挂载 |
| [three](https://threejs.org/) | 0.187.0 | MIT | 三维回放场景与逐帧渲染 |

## 开发依赖

| 包 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| typescript | 5.9.3 | Apache-2.0 | 类型检查与编译 |
| vite | 7.3.8 | MIT | 开发服务器与生产构建 |
| @vitejs/plugin-react | 5.2.0 | MIT | React 的 Vite 插件 |
| vitest | 3.2.7 | MIT | 单元测试 |
| @types/react | 19.3.0 | MIT | React 类型 |
| @types/react-dom | 19.3.0 | MIT | React DOM 类型 |
| @types/three | 0.187.0 | MIT | Three.js 类型 |

## 传递依赖

`package-lock.json` 中共有 164 个包（含上述直接依赖），许可证分布为：MIT 151、ISC 6、Apache-2.0 4、CC-BY-4.0 1、MPL-2.0 1、BSD-3-Clause 1。非 MIT 的包如下，其中只有 Mediabunny 进入运行时产物，其余都在构建/测试阶段使用：

| 包 | 许可证 | 关系 |
| --- | --- | --- |
| mediabunny | MPL-2.0 | 运行时 |
| typescript | Apache-2.0 | 开发 |
| @dimforge/rapier3d-compat | Apache-2.0 | three 的开发依赖，不进入产物 |
| baseline-browser-mapping | Apache-2.0 | 开发 |
| expect-type | Apache-2.0 | 开发 |
| caniuse-lite | CC-BY-4.0 | 开发（数据文件） |
| source-map-js | BSD-3-Clause | 开发 |
| electron-to-chromium、lru-cache、picocolors、semver、siginfo、yallist | ISC | 开发 |

## Mediabunny（MPL-2.0）说明

Mediabunny 以 MPL-2.0 分发，本项目**未修改**其源代码，直接使用 npm 发布包：

- 许可证全文随包提供：`node_modules/mediabunny/LICENSE`。
- 源码获取：<https://github.com/Vanilagy/mediabunny>（对应 1.66.0 标签），或安装后查看 `node_modules/mediabunny/src`。
- MPL-2.0 是文件级弱著佐权：分发包含 Mediabunny 的构建产物时，需要保留其许可证与来源说明；对 Mediabunny 文件本身的修改需要公开。本项目没有这类修改。若后续修改 `node_modules/mediabunny` 内的文件，需把修改后的源码一并公开。

## 素材

- 球场几何、线条、球网、球体、13 mm 印记与 IN/OUT 结果牌全部由代码程序化生成（Three.js 几何 + Canvas 结果牌），不使用外部模型、贴图或图片素材。
- 字体只引用系统字体（Inter、PingFang SC、Hiragino Sans GB、Microsoft YaHei、system-ui），不打包字体文件。
- `public/favicon.svg` 为本项目自绘。
- `docs/images/` 与 `docs/media/` 中的截图和样片都由本项目界面与导出功能生成，随项目一同分发。
- 场地尺寸取自 BWF《Laws of Badminton》的公开规则数值；引用规则数值不构成素材授权问题，本项目与 BWF 无隶属关系，也未使用其标识或转播素材。

## 项目许可证

本项目自身的许可证**尚未选定**，由项目所有者决定后补充 `LICENSE`。在上表依赖许可证允许的范围内，当前仓库内容可被阅读与本地运行；再分发前请等待所有者明确项目许可证。
