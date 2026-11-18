# 依赖与素材说明

## 直接依赖

版本与许可证信息以 [package-lock.json](../package-lock.json) 为准，以下为当前锁定版本。

| 运行时依赖 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| [Mediabunny](https://mediabunny.dev/) | 1.66.0 | MPL-2.0 | MP4 封装 |
| [React](https://react.dev/) | 19.3.1 | MIT | 界面渲染 |
| React DOM | 19.3.1 | MIT | 浏览器挂载 |
| [Three.js](https://threejs.org/) | 0.187.0 | MIT | 三维场景 |

| 开发依赖 | 版本 | 许可证 |
| --- | --- | --- |
| TypeScript | 5.9.3 | Apache-2.0 |
| Vite | 7.3.8 | MIT |
| @vitejs/plugin-react | 5.2.0 | MIT |
| Vitest | 3.2.7 | MIT |
| @types/react | 19.3.0 | MIT |
| @types/react-dom | 19.3.0 | MIT |
| @types/three | 0.187.0 | MIT |

## 传递依赖

当前锁文件中的非 MIT 传递依赖均标记为开发依赖：

| 包 | 许可证 |
| --- | --- |
| @dimforge/rapier3d-compat（由 @types/three 引入） | Apache-2.0 |
| baseline-browser-mapping、expect-type | Apache-2.0 |
| caniuse-lite | CC-BY-4.0 |
| source-map-js | BSD-3-Clause |
| electron-to-chromium、lru-cache、picocolors、semver、siginfo、yallist | ISC |

## Mediabunny 源码与分发

项目通过 npm 包使用 Mediabunny。安装包内的 `node_modules/mediabunny/LICENSE` 提供 MPL-2.0 全文，`node_modules/mediabunny/src/` 提供对应源码，上游仓库为 [Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny)。

分发包含 Mediabunny 的构建产物时，需要保留许可证与版权声明，并告知接收者如何获得对应源码；修改过的 MPL 覆盖文件也须按该许可证提供源码。具体要求见 MPL-2.0 第 3 节。

## 素材来源

- 球场、球网、球体、接触印记与结果牌由代码生成，几何使用 Three.js，结果牌使用 Canvas。
- 字体使用系统字体栈，仓库未包含字体文件；`public/favicon.svg` 为项目自绘图标。
- `docs/images/` 和 `docs/media/` 保存项目界面的截图与导出样片。
- 球场尺寸依据 BWF《Laws of Badminton》，具体版本与来源见[技术方案](TECHNICAL_DESIGN.md#球场几何)。

## 项目授权

仓库尚未提供项目自身的 `LICENSE`，授权方式由项目所有者确定。第三方依赖的许可证与项目自身授权分别适用。
