# AG 音频解析

[![Version](https://img.shields.io/badge/version-2.0.3-blue.svg)](https://github.com/Achordchan/music-chrome/releases)
[![Manifest](https://img.shields.io/badge/manifest-v3-orange.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

面向网页音频资源的嗅探、试听与批量下载工具，基于 Chrome Manifest V3 构建。

在浏览网页的过程中自动识别页面加载的音频资源，提供即时试听与本地保存能力，无需借助开发者工具或第三方抓包软件。

## 功能特性

**资源嗅探**

采用网络请求监听与页面元素监听双通道检测。前者拦截请求与响应头，依据 MIME 类型和资源类型识别音频流；后者捕获页面中 `<audio>` 元素的播放事件，同步提取标题信息。两条通道互为补充，覆盖静态链接与动态加载两类场景。

支持 MP3、WAV、OGG、M4A、AAC、FLAC、WebM 等主流格式。

**在线试听**

在扩展面板内直接试听，无需跳转或下载。播放器提供进度条拖拽定位、实时时间显示与播放状态同步。试听优先复用页面已有的媒体元素，避免重复请求。

**下载管理**

支持单文件下载与多文件 ZIP 打包。批量任务采用串行获取策略，逐个下载并实时反馈进度，避免大文件并发导致的内存峰值。

文件命名依据响应头的 MIME 类型判定真实格式，并按标题、URL 路径、时间戳的优先级生成名称，自动过滤文件系统非法字符。

**会话隔离**

音频记录按标签页独立存储，页面跳转时自动清空，标签页关闭时释放资源，多标签并行工作时互不干扰。

**跨域处理**

通过 `declarativeNetRequest` 声明式规则重写特定站点的请求头，配合扩展自身的主机权限完成跨域资源获取。

## 安装

当前版本以开发者模式加载：

1. 下载或克隆本仓库至本地
2. 在 Chrome 地址栏访问 `chrome://extensions/`
3. 开启右上角的开发者模式
4. 点击「加载已解压的扩展程序」，选择项目根目录

## 使用

打开包含音频内容的网页，扩展会在后台自动识别资源。页面左下角的悬浮入口会显示当前检测到的音频数量，点击可展开面板；也可直接点击浏览器工具栏中的扩展图标。

面板内每条记录支持独立试听与下载，底部的「下载全部」按钮可将全部资源打包为 ZIP 文件。悬浮入口可在面板右上角的开关中关闭。

若页面在扩展启用前已完成加载，刷新页面即可触发检测。

## 技术实现

| 项目 | 说明 |
| --- | --- |
| 扩展规范 | Manifest V3 |
| 资源嗅探 | `chrome.webRequest` 请求与响应头监听 |
| 请求头改写 | `chrome.declarativeNetRequest` 声明式规则 |
| 打包压缩 | JSZip |
| 播放控制 | HTML5 Audio API |

下载流程运行于扩展页面上下文而非 Service Worker，以规避 MV3 环境下 `URL.createObjectURL` 与 Blob 处理的限制。

## 项目结构

```
manifest.json        扩展配置与权限声明
background.js        Service Worker，负责网络嗅探与资源索引
content.js           内容脚本，处理页面内播放、下载与悬浮入口
popup/               扩展面板界面与交互逻辑
rules.json           declarativeNetRequest 请求头规则
lib/jszip.min.js     ZIP 打包依赖
```

## 后续规划

- 下载历史记录与断点续传
- 音频格式转换
- 播放列表与队列管理
- 自定义命名规则与保存路径
- 扩展更多站点的适配规则

## 更新日志

**v2.0.3**

- 重构下载架构，将文件获取与打包迁移至扩展页面上下文，修复 MV3 环境下的兼容性问题
- 依据响应头 MIME 类型判定音频格式，修正无扩展名链接被统一保存为 MP3 的问题
- 修复试听控制的状态同步缺陷与隐藏媒体元素泄漏
- 批量下载改为串行获取，降低内存占用
- 精简权限声明，移除未使用的 `scripting` 权限

**v2.0**

- 优化检测逻辑，提升识别准确率
- 改进文件命名算法
- 界面与交互重构

**v1.0**

- 初始版本发布

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

## 贡献

欢迎通过 [Issue](https://github.com/Achordchan/music-chrome/issues) 反馈问题或提交 Pull Request。

## 作者

Achord — achordchan@gmail.com

## 免责声明

本扩展仅供学习研究与个人合法用途。使用者应遵守目标网站的服务条款及所在地区的法律法规，尊重内容创作者的版权。因不当使用产生的任何后果由使用者自行承担。
