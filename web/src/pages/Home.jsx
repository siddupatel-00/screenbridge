import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

function serverBase() {
  const params = new URLSearchParams(location.search);
  const s = params.get('server');
  if (s) return s.startsWith('http') ? s : `http://${s}`;
  // If running inside Vite dev server (port 5173/3000), target backend on same hostname port 8787
  if (location.port === '5173' || location.port === '3000') {
    return `${location.protocol}//${location.hostname}:8787`;
  }
  // If served directly from the Node backend, use relative paths
  return '';
}

export const SERVER_BASE = serverBase();

export function wsUrl() {
  const base = SERVER_BASE || `${location.protocol}//${location.host}`;
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return base.replace(/^http(s)?:/, wsProto) + '/ws';
}

export default function Home() {
  const [info, setInfo] = useState(null);
  const [hosts, setHosts] = useState([]);

  useEffect(() => {
    fetch(`${SERVER_BASE}/api/info`)
      .then(r => r.json())
      .then(setInfo)
      .catch(() => {});

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

  return (
    <div className="container">
      <div className="card">
        <h2>Welcome to ScreenBridge</h2>
        <p className="muted">
          Cross-platform screen share and second-monitor tool over your local network. Share your screen from Mac, Windows, or Linux, and view/control it from iPads, tablets, phones, or other computers.
        </p>
        <div className="row" style={{ marginTop: 16, flexWrap: 'wrap', gap: 10 }}>
          <Link to="/host" className="btn">Share Screen (Host)</Link>
          <Link to="/client" className="btn secondary">View / Control (Client)</Link>
        </div>
      </div>

      <div className="card">
        <h2>Server Status</h2>
        {info ? (
          <>
            <p>LAN Network URL: <b>{info.ip}:{info.port}</b></p>
            <p className="muted" style={{ marginTop: 6 }}>
              Open <code>http://{info.ip}:{info.port}</code> in the browser of any device connected to the same Wi-Fi.
            </p>
          </>
        ) : (
          <p className="muted">
            Server connecting... Make sure the ScreenBridge server is running.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Active Screen Hosts ({hosts.length})</h2>
        {hosts.length === 0 ? (
          <p className="muted">No hosts currently sharing. Click "Share Screen (Host)" to start.</p>
        ) : (
          <div className="host-list">
            {hosts.map(h => (
              <div className="host-item" key={h.id}>
                <div>
                  <div className="name">{h.name}</div>
                  <div className="info">{h.ip}:{h.port} · {h.clients} connected client(s)</div>
                </div>
                <span className="spacer" />
                <Link to={`/client?host=${h.id}`} className="btn secondary" style={{ padding: '6px 14px' }}>
                  Connect
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
