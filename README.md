# Video Subtitle Burner

一个本地运行的个人视频字幕嵌入工具。上传视频后会自动调用本机 Whisper 识别语音、生成 SRT 字幕，并把字幕嵌入视频底部导出。也可以手动导入或粘贴 SRT / VTT，支持双语字幕、底部电影风格排版、描边、阴影、自动换行和浏览器内导出。

## 使用方式

安装依赖并启动本地服务：

```bash
npm install
npm start
```

然后打开 `http://127.0.0.1:8766`。首次使用先点击“安装依赖”，安装完成后上传视频，应用会自动生成字幕并导出嵌入字幕后的视频。导出格式为 WebM，适合个人归档、网页发布和多数现代播放器播放。

也可以直接打开 `index.html` 使用基础功能；如果需要测试自动加载素材、保存导出结果或修复 WebM duration 元数据，建议使用本地服务。

## 安装语音识别依赖

启动本地服务后，界面里的“安装依赖”按钮会按顺序安装 FFmpeg 和 Whisper。也可以手动执行：

```bash
npm run install:ffmpeg
npm run install:whisper
```

Whisper 脚本会创建 `.venv` 并安装 `openai-whisper`。Whisper 处理视频/音频时还需要系统中存在 `ffmpeg`；macOS 下 FFmpeg 脚本会使用 Homebrew 安装：

```bash
brew install ffmpeg
```

浏览器直接打开 `index.html` 时无法执行本机安装命令，也无法调用 Whisper 自动生成字幕；自动字幕和安装按钮只在 `npm start` 启动的本地服务模式下可用。

## 字幕格式

支持标准 SRT / VTT 时间轴，例如：

```srt
1
00:00:01,000 --> 00:00:04,000
这是第一行字幕

2
00:00:01,000 --> 00:00:04,000
This is the first subtitle line
```

## 说明

- 所有处理都在本机完成，不上传到外部服务。
- 自动字幕会把视频临时保存到本机 `.cache/`，只用于本地 Whisper 识别。
- 主字幕为白色，翻译字幕为黄色，均带黑色描边和阴影。
- 自动生成的是语音原文字幕；如需双语字幕，可继续上传或粘贴翻译字幕作为第二轨。
- 自动成片会优先把字幕硬烧到画面；如果当前 FFmpeg 缺少文字滤镜，则降级为 MP4 内嵌字幕轨。
- 导出 WebM 会自动补 duration 元数据，避免部分播放器显示时长异常。
- `samples/` 中包含测试视频和双语字幕样例；`output/` 中的导出视频默认不提交到 Git。
- 如需导出 MP4，可后续接入 FFmpeg 后端或 ffmpeg.wasm。
