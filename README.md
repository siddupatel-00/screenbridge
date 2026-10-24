# ScreenBridge

Cross-platform screen share and second-monitor tool over your local network (Wi-Fi or Ethernet cable).
Works seamlessly across **macOS, Windows, Linux, iOS, and Android** — host shares a screen, clients view and remotely control it with ultra-low latency.

---

## Features

- 🖥️ **Native Desktop App**: Available for **macOS** (.dmg / .app), **Windows** (.exe), and **Linux** (.AppImage / .deb).
- 📱 **Universal Client (No Install Needed)**: Connect from iPhone, iPad, Android phone/tablet, or any computer browser via PWA.
- ⚡ **Ultra-Fast WebRTC Streaming**: High-quality 1080p/720p/540p streaming with sub-second latency on LAN.
- 🖱️ **Hardware-Accelerated Input Control**:
  - **macOS**: Native CoreGraphics C bridge (`mac-input`) with sub-millisecond mouse movement, clicking, dragging, scrolling, and keyboard typing.
  - **Windows**: High-speed User32 Win32 API bridge.
  - **Linux**: X11 `xdotool` injection.
- 🎯 **Pixel-Accurate Mapping**: Automatically compensates for letterboxing and pillarboxing across different screen ratios.
- 🌐 **Automatic Discovery**: mDNS broadcast (`_screenbridge._tcp`), QR code scanning, and local host list.
- 📦 **Automated Multi-Device CI/CD**: GitHub Actions workflow builds download packages for macOS, Windows, Linux, and Web on every push!

---

## Ways to Run on macOS

### 1. Download Pre-built Release
Go to the **Releases** or **Actions** tab on GitHub and download `ScreenBridge-mac.dmg` or `ScreenBridge.zip`.

### 2. One-Click Finder Launcher
Double-click `ScreenBridge.command` in the project folder to automatically start the server and companion agent and open your default browser.

### 3. Desktop Electron App
```bash
npm install
npm run build
npm run electron
```

### 4. CLI / Terminal
```bash
npm install
npm run build
npm run start:all
```
Then open `http://localhost:8787` in your browser.

---

## Connecting from Other Devices (iPad / Phone / PC)

1. Ensure the device is on the same Wi-Fi network or tethered connection.
2. On your host machine (Mac/PC), open the Host page and click **Share Screen**.
3. Scan the QR code with your phone or tablet camera, or open the URL shown (e.g. `http://192.168.x.x:8787/client?host=...`).
4. Click **Fullscreen / Second Screen** on the client device for a full second-monitor experience!
5. Toggle **Send input** to control the host with touch or mouse.

---

## Building from Source

### Package for macOS (DMG & ZIP)
```bash
npm run dist:mac
```

### Package for Windows (.exe installer & portable)
```bash
npm run dist:win
```

### Package for Linux (AppImage & DEB)
```bash
npm run dist:linux
```

---

## GitHub Actions & Automated Builds

The repository includes a GitHub Actions workflow (`.github/workflows/build.yml`) that automatically compiles and uploads download artifacts for all platforms:
- **macOS**: `ScreenBridge.dmg` & `ScreenBridge.zip` (Universal / Apple Silicon & Intel)
- **Windows**: `ScreenBridge-Setup.exe` & portable executable
- **Linux**: `ScreenBridge.AppImage` & `.deb`
- **Web**: Progressive Web App static distribution
- **Standalone**: Portable cross-platform zip package with runner scripts
