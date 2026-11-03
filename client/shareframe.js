// Рамка и плашка «Вы показываете экран / окно» на время показа экрана в звонке.
// Два прозрачных окна поверх всех окон: рамка (нажатия проходят сквозь неё) и плашка с кнопкой «Остановить». Оба окна исключены из захвата
// (setContentProtection), поэтому собеседники их не видят. Для показа окна положение чужого окна узнаёт маленький вспомогательный процесс
// (macOS: системный скрипт CoreGraphics, Windows: PowerShell и GetWindowRect); на Linux показывается только плашка.
const { BrowserWindow, screen, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

const BORDER = 4, GAP = 3;
let frame = null, pill = null, helper = null, onStopCb = null, lastRect = null;

const JXA = `
ObjC.import('CoreGraphics'); ObjC.import('Foundation');
function run(argv) {
  var id = parseInt(argv[0], 10), out = $.NSFileHandle.fileHandleWithStandardOutput;
  while (true) {
    var res = 'gone';
    try {
      var arr = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionIncludingWindow, id)));
      if (arr && arr.length) { var w = arr[0], b = w.kCGWindowBounds; res = [Math.round(b.X), Math.round(b.Y), Math.round(b.Width), Math.round(b.Height), w.kCGWindowIsOnscreen ? 1 : 0].join(' '); }
    } catch (e) { res = 'err'; }
    out.writeData($.NSString.alloc.initWithUTF8String(res + '\\n').dataUsingEncoding($.NSUTF8StringEncoding));
    $.NSThread.sleepForTimeInterval(0.1);
  }
}`;
const PS = id => `
Add-Type @'
using System; using System.Runtime.InteropServices;
public class W {
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out R r, int s);
}
'@
$h = [IntPtr][Int64]${Number(id)}
while ($true) {
  $o = 'gone'
  if ([W]::IsWindow($h)) {
    $r = New-Object W+R
    if ([W]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) -ne 0) { [void][W]::GetWindowRect($h, [ref]$r) }
    $v = 1; if ([W]::IsIconic($h)) { $v = 0 }
    $o = "$($r.L) $($r.T) $($r.Rt - $r.L) $($r.B - $r.T) $v"
  }
  [Console]::Out.WriteLine($o); [Console]::Out.Flush()
  Start-Sleep -Milliseconds 100
}`;

function overlay(opts) {
  const w = new BrowserWindow({
    show: false, frame: false, transparent: true, resizable: false, movable: false, hasShadow: false, skipTaskbar: true, fullscreenable: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'sharepreload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    ...opts,
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  try { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  try { w.setContentProtection(true); } catch {}   // окно не попадает в то, что видят собеседники
  return w;
}

function placePill(display, name) {
  const wa = display.workArea, W = 440, H = 52;
  if (!pill || pill.isDestroyed()) {
    pill = overlay({ width: W, height: H, focusable: false });
    pill.loadFile(path.join(__dirname, 'src', 'share.html'), { query: { m: 'pill' } });
    pill.webContents.on('did-finish-load', () => pill && !pill.isDestroyed() && pill.webContents.send('share-info', { name }));
    pill.once('ready-to-show', () => pill && !pill.isDestroyed() && pill.showInactive());
  }
  pill.setBounds({ x: Math.round(wa.x + (wa.width - W) / 2), y: wa.y + 8, width: W, height: H });
}

function ensureFrame(round) {
  if (frame && !frame.isDestroyed()) return frame;
  frame = overlay({ width: 200, height: 200, focusable: false });
  frame.setIgnoreMouseEvents(true);
  frame.loadFile(path.join(__dirname, 'src', 'share.html'), { query: { m: 'frame', r: round ? 10 : 6 } });
  return frame;
}

function setFrameRect(rect, visible) {
  const f = frame;
  if (!f || f.isDestroyed()) return;
  if (!visible) { if (f.isVisible()) f.hide(); return; }
  f.setBounds({ x: rect.x, y: rect.y, width: Math.max(40, rect.width), height: Math.max(40, rect.height) });
  if (!f.isVisible()) f.showInactive();
}

function startHelper(id) {
  const args = process.platform === 'darwin' ? ['-l', 'JavaScript', '-e', JXA, String(id)] : null;
  const cmd = process.platform === 'darwin' ? 'osascript' : process.platform === 'win32' ? 'powershell.exe' : null;
  if (!cmd) return;
  helper = spawn(cmd, args || ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS(id)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let buf = '';
  const onLine = line => {
    if (!line) return;
    if (line === 'gone') { setFrameRect(null, false); return; }
    const m = /^(-?\d+) (-?\d+) (\d+) (\d+) ([01])$/.exec(line);
    if (!m) return;
    let r = { x: +m[1], y: +m[2], width: +m[3], height: +m[4] };
    if (process.platform === 'win32') r = screen.screenToDipRect(null, r);
    if (lastRect && lastRect.x === r.x && lastRect.y === r.y && lastRect.width === r.width && lastRect.height === r.height && lastRect.v === m[5]) return;
    lastRect = { ...r, v: m[5] };
    setFrameRect({ x: r.x - GAP, y: r.y - GAP, width: r.width + GAP * 2, height: r.height + GAP * 2 }, m[5] === '1');
    // плашка живёт на том мониторе, где показываемое окно
    const d = screen.getDisplayMatching(r);
    if (pill && !pill.isDestroyed() && m[5] === '1') { const wa = d.workArea; pill.setBounds({ x: Math.round(wa.x + (wa.width - 440) / 2), y: wa.y + 8, width: 440, height: 52 }); }
  };
  helper.stdout.on('data', c => { buf += c.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); } });
  helper.on('error', () => {}); helper.on('exit', () => { helper = null; });
}

// source — элемент desktopCapturer ({ id, name, display_id }); onStop вызывается, когда человек нажал «Остановить» на плашке
function start({ source, onStop }) {
  stop();
  onStopCb = onStop || null; lastRect = null;
  const isWin = String(source.id).startsWith('window:');
  if (isWin) {
    placePill(screen.getPrimaryDisplay(), String(source.name || '').slice(0, 60));
    ensureFrame(true);
    const id = Number(String(source.id).split(':')[1]);
    if (id) startHelper(id);   // нет помощника (Linux): рамки не будет, остаётся плашка
  } else {
    const d = screen.getAllDisplays().find(x => String(x.id) === String(source.display_id)) || screen.getPrimaryDisplay();
    placePill(d, '');
    ensureFrame(false);
    setFrameRect(d.bounds, true);
  }
}
function stop() {
  if (helper) { try { helper.kill(); } catch {} helper = null; }
  for (const w of [frame, pill]) { try { if (w && !w.isDestroyed()) w.destroy(); } catch {} }
  frame = pill = null; onStopCb = null; lastRect = null;
}
ipcMain.on('share-stop', e => { if (pill && !pill.isDestroyed() && e.sender === pill.webContents && onStopCb) onStopCb(); });

module.exports = { start, stop, _state: () => ({ frame, pill, helper }) };
