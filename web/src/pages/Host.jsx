import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SERVER_BASE, wsUrl } from './Home.jsx';
import QRCode from 'qrcode.react';

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

export default function Host() {
  const [hostId, setHostId] = useState(null);
  const [hostName, setHostName] = useState('');
  const [registered, setRegistered] = useState(false);
  const [stream, setStream] = useState(null);
  const [clients, setClients] = useState([]);
  const [logs, setLogs] = useState([]);
  const [controlEnabled, setControlEnabled] = useState(true);
  const controlRef = useRef(true);
  useEffect(() => { controlRef.current = controlEnabled; }, [controlEnabled]);
  const [quality, setQuality] = useState('high');
  const [agentStatus, setAgentStatus] = useState('not connected');
  const [copied, setCopied] = useState(false);

  const videoRef = useRef(null);
  const wsRef = useRef(null);
  const pcsRef = useRef(new Map()); // clientId -> RTCPeerConnection
  const streamRef = useRef(null);

  const log = (m) => setLogs(l => [{ t: new Date().toLocaleTimeString(), m }, ...l].slice(0, 60));

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
          case 'registered':
            setHostId(msg.id);
            setRegistered(true);
            log(`Registered as host: ${msg.id}`);
            break;
          case 'client-joined':
            setClients(c => [...c.filter(x => x.id !== msg.clientId), { id: msg.clientId }]);
            log(`Client joined: ${msg.clientId}`);
            await createPeer(msg.clientId);
            break;
          case 'client-left':
            setClients(c => c.filter(x => x.id !== msg.clientId));
            closePeer(msg.clientId);
            log(`Client left: ${msg.clientId}`);
            break;
          case 'answer': {
            const pc = pcsRef.current.get(msg.from);
            if (pc && pc.signalingState !== 'closed') {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            }
            break;
          }
          case 'ice': {
            const pc = pcsRef.current.get(msg.from);
            if (pc && msg.candidate) {
              try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
            }
            break;
          }
          case 'input':
            if (controlRef.current) handleInput(msg.payload);
            break;
          case 'host-gone':
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

  async function register() {
    const isMac = navigator.userAgent.includes('Mac');
    const isWin = navigator.userAgent.includes('Windows');
    const defaultName = isMac ? 'Mac Screen' : isWin ? 'Windows PC' : 'ScreenBridge Host';
    const name = hostName.trim() || defaultName;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'register-host', name }));
    }
  }

  async function startCapture() {
    try {
      const constraints = quality === 'high'
        ? { video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: true }
        : quality === 'medium'
        ? { video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } }, audio: true }
        : { video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 15 } }, audio: false };

      const s = await navigator.mediaDevices.getDisplayMedia(constraints);
      streamRef.current = s;
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;

      s.getVideoTracks()[0].onended = () => {
        stopCapture();
      };

      log('Screen capture started');

      // Attach tracks and send updated offer to existing connected peers
      for (const [clientId, pc] of pcsRef.current) {
        s.getTracks().forEach(t => pc.addTrack(t, s));
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          wsRef.current?.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription, to: clientId }));
        } catch (err) {
          log(`Failed to update offer for ${clientId}: ${err.message}`);
        }
      }
    } catch (e) {
      log('Capture failed: ' + e.message);
    }
  }

  function stopCapture() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setStream(null);
    if (videoRef.current) videoRef.current.srcObject = null;
    log('Screen sharing stopped');
  }

  async function createPeer(clientId) {
    const pc = new RTCPeerConnection(ICE);
    pcsRef.current.set(clientId, pc);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => pc.addTrack(t, streamRef.current));
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ice', candidate: ev.candidate, to: clientId }));
      }
    };

    pc.onconnectionstatechange = () => log(`${clientId}: ${pc.connectionState}`);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsRef.current?.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription, to: clientId }));
    } catch (err) {
      log(`Offer creation error for ${clientId}: ${err.message}`);
    }
  }

  function closePeer(clientId) {
    const pc = pcsRef.current.get(clientId);
    if (pc) {
      try { pc.close(); } catch {}
      pcsRef.current.delete(clientId);
    }
  }

  // Auto-connecting Agent WebSocket with retry
  const agentWsRef = useRef(null);
  useEffect(() => {
    let agentWs;
    let timer;
    let unmounted = false;

    function connectAgent() {
      if (unmounted) return;
      try {
        agentWs = new WebSocket('ws://127.0.0.1:8790');
        agentWsRef.current = agentWs;

        agentWs.onopen = () => {
          if (!unmounted) setAgentStatus('connected');
        };
        agentWs.onclose = () => {
          if (!unmounted) {
            setAgentStatus('not connected');
            timer = setTimeout(connectAgent, 3000);
          }
        };
        agentWs.onerror = () => {
          if (!unmounted) setAgentStatus('not running');
        };
      } catch {
        if (!unmounted) {
          setAgentStatus('unavailable');
          timer = setTimeout(connectAgent, 3000);
        }
      }
    }

    connectAgent();

    return () => {
      unmounted = true;
      clearTimeout(timer);
      try { agentWs && agentWs.close(); } catch {}
    };
  }, []);

  function handleInput(payload) {
    const aw = agentWsRef.current;
    if (aw && aw.readyState === WebSocket.OPEN) {
      aw.send(JSON.stringify(payload));
    }
  }

  function unregister() {
    stopCapture();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unregister-host' }));
    }
    setRegistered(false);
    setHostId(null);
    for (const [id] of pcsRef.current) closePeer(id);
    setClients([]);
  }

  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, []);

  const clientUrl = hostId ? `${window.location.origin}/client?host=${hostId}` : '';

  function copyClientUrl() {
    if (!clientUrl) return;
    navigator.clipboard.writeText(clientUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="container">
      {!registered ? (
        <div className="card">
          <h2>Become a Host</h2>
          <p className="muted" style={{ marginBottom: 16 }}>Share this computer's screen so tablets, phones, or other computers can view and control it.</p>
          <label className="label">Device name</label>
          <input className="input" value={hostName} onChange={e => setHostName(e.target.value)} placeholder="e.g. My MacBook / Office PC" />
          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={register}>Register as Host</button>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <h2>Host: {hostName || hostId}</h2>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span className="badge ok">Online</span>
              <span className="badge">ID: {hostId}</span>
              <span className="badge">{clients.length} client(s)</span>
              <span className={`badge ${agentStatus === 'connected' ? 'ok' : 'warn'}`}>
                Agent: {agentStatus}
              </span>
            </div>
            <div style={{ marginTop: 16 }} className="row">
              {!stream ? (
                <button className="btn" onClick={startCapture}>Share Screen</button>
              ) : (
                <button className="btn secondary" onClick={stopCapture}>Stop Sharing</button>
              )}
              <select className="input" style={{ width: 140 }} value={quality} onChange={e => setQuality(e.target.value)}>
                <option value="high">High 1080p</option>
                <option value="medium">Medium 720p</option>
                <option value="low">Low 540p</option>
              </select>
              <button className="btn danger" onClick={unregister}>Unregister</button>
            </div>
          </div>

          <div className="grid grid2">
            <div className="card">
              <h2>Preview</h2>
              <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', borderRadius: 8, background: '#000', minHeight: 180 }} />
              {agentStatus !== 'connected' && (
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Tip: Start the companion agent (<code>node agent/agent.js</code>) on this host to allow clients to control your mouse and keyboard.
                </p>
              )}
            </div>
            <div className="card">
              <h2>Connect Clients</h2>
              <p className="muted">Scan QR or open this link on phones, tablets, or other computers on the same network.</p>
              {hostId && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '14px 0' }}>
                  <div style={{ padding: 8, background: '#fff', borderRadius: 8 }}>
                    <QRCode value={clientUrl} size={170} />
                  </div>
                  <div className="row" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}>
                    <button className="btn secondary" style={{ fontSize: 13, padding: '6px 12px' }} onClick={copyClientUrl}>
                      {copied ? '✓ Copied Link!' : '📋 Copy Client Link'}
                    </button>
                  </div>
                </div>
              )}
              <p style={{ fontSize: 12, wordBreak: 'break-all', textAlign: 'center' }} className="muted">{clientUrl}</p>
              <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <label className="label">Allow remote control input</label>
                <div className="toggle">
                  <div className={`switch ${controlEnabled ? 'on' : ''}`} onClick={() => setControlEnabled(v => !v)} />
                  <span>{controlEnabled ? 'Enabled' : 'Disabled'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Connected Clients ({clients.length})</h2>
            {clients.length === 0 && <p className="muted">No clients connected yet.</p>}
            <div className="host-list">
              {clients.map(c => (
                <div className="host-item" key={c.id}>
                  <div className="name">{c.id}</div>
                  <span className="spacer" />
                  <span className="badge ok">connected</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Event Log</h2>
            <div className="log">
              {logs.map((l, i) => <div key={i}><b>{l.t}</b> {l.m}</div>)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
