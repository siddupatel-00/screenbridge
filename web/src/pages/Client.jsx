import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SERVER_BASE, wsUrl } from './Home.jsx';

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

export default function Client() {
  const [params] = useSearchParams();
  const [hostId, setHostId] = useState(params.get('host') || '');
  const [hosts, setHosts] = useState([]);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('disconnected');
  const [fullscreen, setFullscreen] = useState(false);
  const [control, setControl] = useState(true);
  const [hasAudio, setHasAudio] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [logs, setLogs] = useState([]);

  const videoRef = useRef(null);
  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(new MediaStream());
  const inputTargetRef = useRef(null);

  const log = (m) => setLogs(l => [{ t: new Date().toLocaleTimeString(), m }, ...l].slice(0, 40));

  // Poll available hosts
  useEffect(() => {
    const load = () => {
      fetch(`${SERVER_BASE}/api/hosts`)
        .then(r => r.json())
        .then(d => { if (d.hosts) setHosts(d.hosts); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let ws;
    let destroyed = false;

    function connectSignaling() {
      if (destroyed) return;
      ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => log('Connected to signaling server');
      ws.onmessage = async (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }

        switch (msg.type) {
          case 'joined':
            setStatus('Joined host, waiting for stream...');
            log('Joined host session');
            break;
          case 'offer':
            await handleOffer(msg);
            break;
          case 'ice':
            try {
              if (pcRef.current && msg.candidate) {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
              }
            } catch {}
            break;
          case 'host-gone':
            setStatus('Host went offline');
            disconnect();
            break;
          case 'hosts':
            if (msg.hosts) setHosts(msg.hosts);
            break;
          case 'error':
            setStatus(`Error: ${msg.message}`);
            log(`Server error: ${msg.message}`);
            break;
        }
      };

      ws.onclose = () => {
        log('Signaling server disconnected. Reconnecting...');
        if (!destroyed) setTimeout(connectSignaling, 3000);
      };
    }

    connectSignaling();

    return () => {
      destroyed = true;
      try { ws && ws.close(); } catch {}
    };
  }, []);

  async function handleOffer(msg) {
    let pc = pcRef.current;
    if (!pc || pc.signalingState === 'closed') {
      pc = new RTCPeerConnection(ICE);
      pcRef.current = pc;

      pc.ontrack = (ev) => {
        log(`Received ${ev.track.kind} track`);
        if (ev.track.kind === 'audio') setHasAudio(true);

        if (ev.streams && ev.streams[0]) {
          streamRef.current = ev.streams[0];
        } else {
          streamRef.current.addTrack(ev.track);
        }

        if (videoRef.current) {
          videoRef.current.srcObject = streamRef.current;
          videoRef.current.play().catch(() => {});
        }
        setConnected(true);
        setStatus('streaming');
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'ice', candidate: ev.candidate, to: msg.from }));
        }
      };

      pc.onconnectionstatechange = () => {
        setStatus(pc.connectionState);
        log(`Connection state: ${pc.connectionState}`);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          setConnected(false);
        }
      };
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsRef.current?.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription, to: msg.from }));
    } catch (err) {
      log('Error answering offer: ' + err.message);
    }
  }

  function connect(targetId) {
    const idToUse = targetId || hostId;
    if (!idToUse) {
      setStatus('Please select or enter a host ID');
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'join-host', hostId: idToUse }));
      setStatus('Connecting to host...');
    } else {
      setStatus('Signaling server not connected');
    }
  }

  function disconnect() {
    if (pcRef.current) {
      try { pcRef.current.close(); } catch {}
      pcRef.current = null;
    }
    streamRef.current = new MediaStream();
    if (videoRef.current) videoRef.current.srcObject = null;
    setConnected(false);
    setStatus('disconnected');
    setFullscreen(false);
  }

  // Input mapping with aspect-ratio letterboxing compensation
  function sendInput(payload) {
    if (!control || !connected) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', payload }));
    }
  }

  function norm(e, video) {
    if (!video) return { x: 0, y: 0 };
    const r = video.getBoundingClientRect();
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (!vw || !vh || !r.width || !r.height) {
      const rawX = (e.clientX - r.left) / r.width;
      const rawY = (e.clientY - r.top) / r.height;
      return { x: Math.max(0, Math.min(1, rawX)), y: Math.max(0, Math.min(1, rawY)) };
    }

    const containerAspect = r.width / r.height;
    const videoAspect = vw / vh;
    let renderW, renderH, offsetX, offsetY;

    if (containerAspect > videoAspect) {
      // Pillarboxed (bars on left/right)
      renderH = r.height;
      renderW = r.height * videoAspect;
      offsetX = (r.width - renderW) / 2;
      offsetY = 0;
    } else {
      // Letterboxed (bars on top/bottom)
      renderW = r.width;
      renderH = r.width / videoAspect;
      offsetX = 0;
      offsetY = (r.height - renderH) / 2;
    }

    const clickX = e.clientX - r.left - offsetX;
    const clickY = e.clientY - r.top - offsetY;

    const x = Math.max(0, Math.min(1, clickX / renderW));
    const y = Math.max(0, Math.min(1, clickY / renderH));
    return { x, y };
  }

  function onMouseMove(e) {
    if (!videoRef.current) return;
    const { x, y } = norm(e, videoRef.current);
    sendInput({ type: 'mousemove', x, y });
  }

  function onMouseDown(e) {
    if (!videoRef.current) return;
    const { x, y } = norm(e, videoRef.current);
    sendInput({ type: 'mousedown', x, y, button: e.button });
  }

  function onMouseUp(e) {
    if (!videoRef.current) return;
    const { x, y } = norm(e, videoRef.current);
    sendInput({ type: 'mouseup', x, y, button: e.button });
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  function onWheel(e) {
    e.preventDefault();
    sendInput({ type: 'wheel', dx: e.deltaX, dy: e.deltaY });
  }

  function onKeyDown(e) {
    sendInput({
      type: 'keydown',
      key: e.key,
      code: e.code,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey
    });
  }

  function onKeyUp(e) {
    sendInput({ type: 'keyup', key: e.key, code: e.code });
  }

  function onTouch(e) {
    e.preventDefault();
    const t = e.touches[0] || e.changedTouches[0];
    if (!t || !videoRef.current) return;
    const { x, y } = norm(t, videoRef.current);
    const type = e.type === 'touchstart' ? 'mousedown' : e.type === 'touchmove' ? 'mousemove' : 'mouseup';
    sendInput({ type, x, y, button: 0 });
  }

  useEffect(() => {
    if (fullscreen) {
      const onKey = (e) => {
        if (e.key === 'Escape') setFullscreen(false);
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [fullscreen]);

  function toggleMute() {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  }

  if (fullscreen && connected) {
    return (
      <div
        className="fullscreen-view"
        ref={inputTargetRef}
        tabIndex={0}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onContextMenu={onContextMenu}
        onWheel={onWheel}
        onTouchStart={onTouch}
        onTouchMove={onTouch}
        onTouchEnd={onTouch}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        style={{ touchAction: 'none' }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isMuted}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
        <div className="overlay">
          <button className="btn secondary" onClick={() => setFullscreen(false)}>Exit Fullscreen (Esc)</button>
          {hasAudio && (
            <button className="btn secondary" onClick={toggleMute}>
              {isMuted ? '🔊 Unmute' : '🔇 Mute'}
            </button>
          )}
          <span className="pill">{status}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <h2>Connect to Host</h2>
        <label className="label">Available Hosts</label>
        <select
          className="input"
          value={hostId}
          onChange={e => {
            setHostId(e.target.value);
            if (e.target.value && !connected) connect(e.target.value);
          }}
        >
          <option value="">-- select host --</option>
          {hosts.map(h => (
            <option key={h.id} value={h.id}>
              {h.name} ({h.ip}) - {h.clients} connected
            </option>
          ))}
        </select>
        <div className="row" style={{ marginTop: 10 }}>
          <input
            className="input"
            value={hostId}
            onChange={e => setHostId(e.target.value)}
            placeholder="or paste host id"
          />
        </div>
        <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
          <button className="btn" onClick={() => connect()} disabled={connected}>Connect</button>
          <button className="btn secondary" onClick={disconnect} disabled={!connected}>Disconnect</button>
          <span className={`badge ${connected ? 'ok' : ''}`}>{status}</span>
        </div>
      </div>

      <div className="card">
        <h2>Screen Stream</h2>
        <div style={{ position: 'relative', width: '100%', borderRadius: 8, overflow: 'hidden', background: '#000' }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isMuted}
            onMouseMove={onMouseMove}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onContextMenu={onContextMenu}
            onWheel={onWheel}
            onTouchStart={onTouch}
            onTouchMove={onTouch}
            onTouchEnd={onTouch}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            tabIndex={0}
            style={{
              width: '100%',
              display: 'block',
              minHeight: 240,
              cursor: control ? 'crosshair' : 'default',
              touchAction: 'none'
            }}
          />
        </div>
        <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 10 }}>
          <button className="btn secondary" onClick={() => setFullscreen(true)} disabled={!connected}>
            ⛶ Fullscreen / Second Screen
          </button>
          {hasAudio && (
            <button className="btn secondary" onClick={toggleMute}>
              {isMuted ? '🔊 Unmute Audio' : '🔇 Mute Audio'}
            </button>
          )}
          <label className="toggle">
            <div className={`switch ${control ? 'on' : ''}`} onClick={() => setControl(v => !v)} />
            <span>Send input to host</span>
          </label>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Tip: On iPad, tablet, or phone, use Fullscreen for a native second-monitor experience. Touch and mouse events control the host directly.
        </p>
      </div>

      <div className="card">
        <h2>Event Log</h2>
        <div className="log">
          {logs.map((l, i) => <div key={i}><b>{l.t}</b> {l.m}</div>)}
        </div>
      </div>
    </div>
  );
}
