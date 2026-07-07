# Video Subtitle Burner

一个本地运行的个人视频字幕嵌入工具。上传视频后，可导入或粘贴 SRT / VTT 字幕，支持双语字幕、底部电影风格排版、描边、阴影、自动换行和浏览器内导出。

## 使用方式

安装依赖并启动本地服务：

```bash
npm install
npm start
```

然后打开 `http://127.0.0.1:8766`，上传视频和字幕后点击“导出视频”。导出格式为 WebM，适合个人归档、网页发布和多数现代播放器播放。

也可以直接打开 `index.html` 使用基础功能；如果需要测试自动加载素材、保存导出结果或修复 WebM duration 元数据，建议使用本地服务。

## 安装语音识别依赖

启动本地服务后，界面里的“安装 Whisper”和“安装 FFmpeg”按钮会调用后端固定脚本：

```bash
npm run install:whisper
npm run install:ffmpeg
```

Whisper 脚本会创建 `.venv` 并安装 `openai-whisper`。Whisper 处理视频/音频时还需要系统中存在 `ffmpeg`；macOS 下 FFmpeg 脚本会使用 Homebrew 安装：

```bash
brew install ffmpeg
```

浏览器直接打开 `index.html` 时无法执行本机安装命令，因此安装按钮只在 `npm start` 启动的本地服务模式下可用。

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

- 所有处理都在浏览器本地完成，不上传视频文件。
- 主字幕为白色，翻译字幕为黄色，均带黑色描边和阴影。
- 导出 WebM 会自动补 duration 元数据，避免部分播放器显示时长异常。
- `samples/` 中包含测试视频和双语字幕样例；`output/` 中的导出视频默认不提交到 Git。
- 如需导出 MP4，可后续接入 FFmpeg 后端或 ffmpeg.wasm。
