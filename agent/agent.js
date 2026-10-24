import { WebSocketServer } from 'ws';
import { spawn, spawnSync, execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8790;
const platform = os.platform();

function run(cmd, opts = {}) {
  try { execSync(cmd, { stdio: 'ignore', ...opts }); } catch {}
}

// ---- macOS Native Bridge Setup ----
let macProcess = null;
let macScreenSize = null;

if (platform === 'darwin') {
  let binPath = path.join(__dirname, 'bin', 'mac-input');
  if (!fs.existsSync(binPath) && binPath.includes('app.asar')) {
    binPath = binPath.replace('app.asar', 'app.asar.unpacked');
  }
  const srcPath = path.join(__dirname, 'src', 'mac_input.c');

  // If binary doesn't exist, try compiling it
  if (!fs.existsSync(binPath) && fs.existsSync(srcPath)) {
    try {
      fs.mkdirSync(path.join(__dirname, 'bin'), { recursive: true });
      execSync(`clang -arch arm64 -arch x86_64 -framework ApplicationServices -O2 "${srcPath}" -o "${binPath}"`, { stdio: 'ignore' });
    } catch {
      try {
        execSync(`clang -framework ApplicationServices -O2 "${srcPath}" -o "${binPath}"`, { stdio: 'ignore' });
      } catch (e) {
        console.warn('Could not compile native mac-input helper:', e.message);
      }
    }
  }

  if (fs.existsSync(binPath)) {
    try {
      macProcess = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      macProcess.stdout.on('data', (data) => {
        const str = data.toString();
        const match = str.match(/SCREEN\s+(\d+)\s+(\d+)/);
        if (match) {
          macScreenSize = { w: parseInt(match[1]), h: parseInt(match[2]) };
        }
      });
      macProcess.stderr.on('data', (d) => console.error('mac-input error:', d.toString().trim()));
      macProcess.on('exit', () => { macProcess = null; });
    } catch (err) {
      console.warn('Failed to start native mac-input helper:', err.message);
      macProcess = null;
    }
  }
}

// Screen size detection
function getScreenSize() {
  if (macScreenSize) return macScreenSize;

  if (platform === 'darwin') {
    try {
      const out = spawnSync('osascript', ['-l', 'JavaScript', '-e', 'ObjC.import("CoreGraphics"); const d = $.CGMainDisplayID(); `${$.CGDisplayPixelsWide(d)} ${$.CGDisplayPixelsHigh(d)}`;'], { encoding: 'utf8' });
      const parts = (out.stdout || '').trim().split(/\s+/);
      if (parts.length >= 2 && parseInt(parts[0]) > 0) {
        return { w: parseInt(parts[0]), h: parseInt(parts[1]) };
      }
    } catch {}
    try {
      const out = spawnSync('osascript', ['-e', 'tell application "Finder" to get bounds of window of desktop'], { encoding: 'utf8' });
      const parts = (out.stdout || '').trim().split(',').map(s => parseInt(s.trim()));
      if (parts[2] && parts[3]) return { w: parts[2], h: parts[3] };
    } catch {}
    return { w: 1920, h: 1080 };
  }

  if (platform === 'win32') {
    try {
      const out = spawnSync('powershell', ['-NoProfile', '-Command', '(Add-Type -AssemblyName System.Windows.Forms; $s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; "$($s.Width) $($s.Height)"'], { encoding: 'utf8' });
      const parts = (out.stdout || '').trim().split(/\s+/);
      return { w: parseInt(parts[0]) || 1920, h: parseInt(parts[1]) || 1080 };
    } catch { return { w: 1920, h: 1080 }; }
  }

  // linux
  try {
    const out = spawnSync('xdpyinfo', [], { encoding: 'utf8' });
    const m = (out.stdout || '').match(/dimensions:\s+(\d+)x(\d+)/);
    if (m) return { w: +m[1], h: +m[2] };
  } catch {}

  return { w: 1920, h: 1080 };
}

let screen = getScreenSize();
console.log(`ScreenBridge agent (${platform}) screen=${screen.w}x${screen.h}`);

// Windows persistent powershell bridge
let ps = null;
if (platform === 'win32') {
  try {
    ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const setup = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class SB {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
`;
    ps.stdin.write(setup);
    ps.stderr.on('data', d => console.error('ps err:', d.toString().trim()));
  } catch (e) {
    console.error('Failed to spawn PowerShell on Windows:', e.message);
  }
}

// Key code mapping for macOS
const MAC_KEY_CODES = {
  'Enter': 36, 'Return': 36, 'Tab': 48, ' ': 49, 'Space': 49,
  'Backspace': 51, 'Escape': 53, 'Meta': 55, 'Command': 55,
  'Shift': 56, 'CapsLock': 57, 'Alt': 58, 'Option': 58, 'Control': 59,
  'ArrowLeft': 123, 'ArrowRight': 124, 'ArrowDown': 125, 'ArrowUp': 126,
  'Delete': 117, 'Home': 115, 'End': 119, 'PageUp': 116, 'PageDown': 121,
  'F1': 122, 'F2': 120, 'F3': 99, 'F4': 118, 'F5': 96, 'F6': 97,
  'F7': 98, 'F8': 100, 'F9': 101, 'F10': 109, 'F11': 103, 'F12': 111,
};

// Key code mapping for Windows Virtual Keys
const VK = {
  'Enter': 13, 'Tab': 9, 'Backspace': 8, 'Escape': 27, ' ': 32, 'Space': 32,
  'ArrowLeft': 37, 'ArrowUp': 38, 'ArrowRight': 39, 'ArrowDown': 40,
  'Shift': 16, 'Control': 17, 'Alt': 18, 'Meta': 91, 'CapsLock': 20,
  'Delete': 46, 'Home': 36, 'End': 35, 'PageUp': 33, 'PageDown': 34, 'Insert': 45,
};

function vkFor(key) {
  if (VK[key]) return VK[key];
  if (key && key.length === 1) {
    const c = key.toUpperCase().charCodeAt(0);
    if (c >= 65 && c <= 90) return c; // A-Z
    if (c >= 48 && c <= 57) return c; // 0-9
  }
  const f = key?.match(/^F(\d{1,2})$/);
  if (f) return 111 + (parseInt(f[1]) - 1);
  return null;
}

const modState = { ctrl: false, shift: false, alt: false, meta: false };

function pressModifier(mod, down) {
  const vks = { ctrl: 17, shift: 16, alt: 18, meta: 91 };
  const vk = vks[mod];
  if (platform === 'win32' && ps) {
    ps.stdin.write(`[SB]::keybd_event(${vk},0,${down ? 0 : 2},[UIntPtr]::Zero)\n`);
  } else if (platform === 'linux') {
    const name = { ctrl: 'ctrl', shift: 'shift', alt: 'alt', meta: 'super' }[mod];
    if (down) run(`xdotool keydown ${name}`); else run(`xdotool keyup ${name}`);
  }
}

let lastMove = 0;
function inject(ev) {
  if (macScreenSize && (screen.w !== macScreenSize.w || screen.h !== macScreenSize.h)) {
    screen = macScreenSize;
  }
  const x = Math.round((ev.x ?? 0) * screen.w);
  const y = Math.round((ev.y ?? 0) * screen.h);

  // --- macOS ---
  if (platform === 'darwin') {
    if (macProcess && macProcess.stdin.writable) {
      switch (ev.type) {
        case 'mousemove':
          if (Date.now() - lastMove < 12) return;
          lastMove = Date.now();
          macProcess.stdin.write(`m ${x} ${y}\n`);
          break;
        case 'mousedown':
          macProcess.stdin.write(`m ${x} ${y}\n`);
          macProcess.stdin.write(`d ${ev.button ?? 0}\n`);
          break;
        case 'mouseup':
          macProcess.stdin.write(`u ${ev.button ?? 0}\n`);
          break;
        case 'wheel': {
          const dy = Math.round((ev.dy || 0) * -1);
          const dx = Math.round((ev.dx || 0) * -1);
          macProcess.stdin.write(`w ${dy} ${dx}\n`);
          break;
        }
        case 'keydown': {
          const code = MAC_KEY_CODES[ev.key];
          if (code !== undefined) {
            macProcess.stdin.write(`k ${code} 1\n`);
          } else if (ev.key && ev.key.length === 1) {
            macProcess.stdin.write(`t ${ev.key}\n`);
          }
          break;
        }
        case 'keyup': {
          const code = MAC_KEY_CODES[ev.key];
          if (code !== undefined) {
            macProcess.stdin.write(`k ${code} 0\n`);
          }
          break;
        }
      }
      return;
    }

    // Fallback if native helper is not running
    switch (ev.type) {
      case 'mousemove':
        if (Date.now() - lastMove < 16) return;
        lastMove = Date.now();
        run(`cliclick m:${x},${y}`);
        break;
      case 'mousedown':
        run(`cliclick ${ev.button === 2 ? 'rc' : 'c'}:${x},${y}`);
        break;
      case 'wheel':
        break;
      case 'keydown':
        if (ev.key && ev.key.length === 1 && !/["\\]/.test(ev.key)) {
          run(`osascript -e 'tell application "System Events" to keystroke "${ev.key}"'`);
        }
        break;
    }
    return;
  }

  // --- Windows ---
  if (platform === 'win32') {
    if (!ps) return;
    switch (ev.type) {
      case 'mousemove':
        if (Date.now() - lastMove < 12) return;
        lastMove = Date.now();
        ps.stdin.write(`[SB]::SetCursorPos(${x},${y})\n`);
        break;
      case 'mousedown': {
        ps.stdin.write(`[SB]::SetCursorPos(${x},${y})\n`);
        const flag = ev.button === 2 ? 0x0008 : 0x0002;
        ps.stdin.write(`[SB]::mouse_event(${flag},0,0,0,0)\n`);
        break;
      }
      case 'mouseup': {
        const flag = ev.button === 2 ? 0x0010 : 0x0004;
        ps.stdin.write(`[SB]::mouse_event(${flag},0,0,0,0)\n`);
        break;
      }
      case 'wheel': {
        const delta = Math.round((ev.dy || 0) * -120 / 100);
        ps.stdin.write(`[SB]::mouse_event(0x0800,0,0,${delta},0)\n`);
        break;
      }
      case 'keydown': {
        if (ev.ctrl && !modState.ctrl) { pressModifier('ctrl', true); modState.ctrl = true; }
        if (ev.shift && !modState.shift) { pressModifier('shift', true); modState.shift = true; }
        if (ev.alt && !modState.alt) { pressModifier('alt', true); modState.alt = true; }
        if (ev.meta && !modState.meta) { pressModifier('meta', true); modState.meta = true; }
        const vk = vkFor(ev.key);
        if (vk) ps.stdin.write(`[SB]::keybd_event(${vk},0,0,[UIntPtr]::Zero)\n`);
        break;
      }
      case 'keyup': {
        const vk = vkFor(ev.key);
        if (vk) ps.stdin.write(`[SB]::keybd_event(${vk},0,2,[UIntPtr]::Zero)\n`);
        if (ev.key === 'Control') { pressModifier('ctrl', false); modState.ctrl = false; }
        if (ev.key === 'Shift') { pressModifier('shift', false); modState.shift = false; }
        if (ev.key === 'Alt') { pressModifier('alt', false); modState.alt = false; }
        if (ev.key === 'Meta') { pressModifier('meta', false); modState.meta = false; }
        break;
      }
    }
    return;
  }

  // --- Linux ---
  switch (ev.type) {
    case 'mousemove':
      if (Date.now() - lastMove < 16) return;
      lastMove = Date.now();
      run(`xdotool mousemove ${x} ${y}`);
      break;
    case 'mousedown': {
      const btn = ev.button === 2 ? 3 : (ev.button === 1 ? 2 : 1);
      run(`xdotool mousemove ${x} ${y} mousedown ${btn}`);
      break;
    }
    case 'mouseup': {
      const btn = ev.button === 2 ? 3 : (ev.button === 1 ? 2 : 1);
      run(`xdotool mouseup ${btn}`);
      break;
    }
    case 'wheel':
      run(`xdotool click ${ev.dy > 0 ? 5 : 4}`);
      break;
    case 'keydown':
      if (ev.key) run(`xdotool keydown ${ev.key}`);
      break;
    case 'keyup':
      if (ev.key) run(`xdotool keyup ${ev.key}`);
      break;
  }
}

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
wss.on('connection', (ws) => {
  console.log('Client connected to agent');
  ws.send(JSON.stringify({ type: 'hello', platform, screen }));
  ws.on('message', (raw) => {
    let ev; try { ev = JSON.parse(raw); } catch { return; }
    try { inject(ev); } catch (e) { console.error('inject err', e.message); }
  });
  ws.on('close', () => console.log('Client disconnected from agent'));
});

console.log(`ScreenBridge agent listening on ws://127.0.0.1:${PORT}`);
console.log(`Native input acceleration: ${macProcess ? 'active (mac-input)' : (platform === 'win32' ? 'active (PowerShell)' : 'xdotool')}`);
