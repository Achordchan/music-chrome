# AG音频解析 Chrome 扩展

![Version](https://img.shields.io/badge/version-2.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

一款智能的音频播放检测和下载工具，只在音频播放时工作。

## ✨ 特性

### 🎯 智能检测
- 只在音频实际播放时进行检测
- 支持多种音频格式 (MP3, WAV, OGG, M4A, AAC, FLAC)
- 准确识别音频资源，避免误报

### 🎵 音频试听
- 实时进度条显示
- 支持进度条拖动和点击定位
- 显示当前播放时间和总时长
- 播放状态同步

### 💾 下载功能
- 单个音频下载
- 批量打包下载 (ZIP格式)
- 智能文件命名
- 下载进度提示

### 🎨 界面设计
- 现代化的 iOS 风格界面
- 响应式布局
- 流畅的动画效果
- 优雅的空状态显示

### 🛠 其他功能
- 悬浮图标开关
- 错误处理优化
- 跨域资源访问
- 标签页状态同步

## 🚀 技术栈

- Chrome Extension API
- JavaScript (ES6+)
- HTML5 Audio API
- JSZip
- CSS3 Animations

## 📦 安装

1. 下载源代码
2. 打开 Chrome 扩展页面 (`chrome://extensions/`)
3. 开启开发者模式
4. 点击"加载已解压的扩展程序"
5. 选择项目目录

## 🔧 使用方法

1. 打开含有音频的网页
2. 播放音频时会自动检测
3. 点击扩展图标查看检测到的音频
4. 可以试听、单个下载或批量下载

## 👨‍💻 作者

- 作者: Achord
- 邮箱: achordchan@gmail.com
- 版本: 2.0

## 📝 待优化

- [ ] 添加音频格式转换功能
- [ ] 支持更多音频源的检测
- [ ] 添加下载历史记录
- [ ] 优化大文件下载性能
- [ ] 添加自定义下载选项
- [ ] 支持播放列表功能

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📜 更新日志

### v2.0
- 优化音频检测逻辑，只在播放时检测
- 改进文件命名算法
- 优化下载功能
- UI/UX 改进

### v1.0
- 初始版本发布