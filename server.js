// RemoteDesktop 릴레이 서버
// 두 피어(host/viewer)가 각자 바깥으로 WebSocket 접속 → room 기준 페어링 → 바이너리 파이프.
// 화면 데이터는 앱에서 종단간 TLS 로 암호화되므로 릴레이는 암호문만 중계(내용 못 봄).
//
// 프로토콜:
//   ws(s)://<host>/ws?room=<deviceId>&role=host    → 호스트: 뷰어를 기다림(대기 등록)
//   ws(s)://<host>/ws?room=<deviceId>&role=viewer  → 뷰어: 대기 중인 호스트와 페어링
// 페어링되면 이후 모든 바이너리 프레임을 상대에게 그대로 전달. 제어 메시지 없음(순수 파이프).

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
// room -> 대기 중인 host WebSocket (동시 1:1 이므로 room 당 하나)
const waitingHosts = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('RemoteDesktop relay OK');
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 * 1024 });

wss.on('connection', (ws, req) => {
  let room, role;
  try {
    const u = new URL(req.url, 'http://x');
    room = u.searchParams.get('room');
    role = u.searchParams.get('role');
  } catch { ws.close(); return; }

  if (!room || (role !== 'host' && role !== 'viewer')) { ws.close(); return; }
  ws.binaryType = 'nodebuffer';

  if (role === 'host') {
    // 이전 대기 호스트가 있으면 교체(오래된 것 정리)
    const prev = waitingHosts.get(room);
    if (prev && prev !== ws) { try { prev.close(); } catch {} }
    waitingHosts.set(room, ws);
    ws.on('close', () => { if (waitingHosts.get(room) === ws) waitingHosts.delete(room); });
    // 페어링 전까지 아무것도 안 함(뷰어가 오면 pair 에서 처리)
    return;
  }

  // viewer
  const host = waitingHosts.get(room);
  if (!host || host.readyState !== 1) {
    // 대기 중인 호스트 없음 → 즉시 종료(뷰어가 잠시 후 재시도)
    try { ws.close(1013, 'host_unavailable'); } catch {}
    return;
  }
  waitingHosts.delete(room); // 이 host 는 이 세션에 소비됨(1:1)
  pair(host, ws);
});

function pair(a, b) {
  const aToB = (data) => { if (b.readyState === 1) b.send(data); };
  const bToA = (data) => { if (a.readyState === 1) a.send(data); };
  a.on('message', aToB);
  b.on('message', bToA);
  const closeBoth = () => { try { a.close(); } catch {} try { b.close(); } catch {} };
  a.on('close', closeBoth);
  b.on('close', closeBoth);
  a.on('error', closeBoth);
  b.on('error', closeBoth);
}

server.listen(PORT, () => console.log('RemoteDesktop relay listening on ' + PORT));
