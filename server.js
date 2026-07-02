// RemoteDesktop 릴레이 서버
// 두 피어(host/viewer)가 각자 바깥으로 WebSocket 접속 → room 기준 페어링 → 바이너리 파이프.
// 화면 데이터는 앱에서 종단간 TLS 로 암호화되므로 릴레이는 암호문만 중계(내용 못 봄).
//
// 프로토콜:
//   ws(s)://<host>/ws?room=<deviceId>&role=host    → 호스트: 뷰어를 기다림(대기 등록)
//   ws(s)://<host>/ws?room=<deviceId>&role=viewer  → 뷰어: 대기 중인 호스트와 페어링
// 페어링되면 이후 모든 바이너리 프레임을 상대에게 그대로 전달(순수 파이프).
//
// 보안/견고성:
//   - room 은 추측 불가한 GUID(기기 ID). 릴레이는 암호문만 중계하므로 내용 접근 불가.
//   - IP 별 연결 rate-limit (플러딩/플래핑 DoS 완화)
//   - ping/pong heartbeat 로 좀비 소켓 정리
//   - 백프레셔(bufferedAmount 상한)로 메모리 고갈 방지

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const MAX_PAYLOAD = 4 * 1024 * 1024;      // TLS 레코드는 ≤~16KB, 여유롭게 4MB 상한
const BUFFER_LIMIT = 8 * 1024 * 1024;     // 상대 송신 버퍼 8MB 초과 시 세션 종료(느린 소비자 격리)
const RATE_WINDOW_MS = 10000;
const RATE_MAX = 15;                       // IP 당 10초 15연결 초과 시 거절

const waitingHosts = new Map();  // room -> host ws
const rate = new Map();          // ip -> [timestamps]

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('RemoteDesktop relay OK');
  } else { res.writeHead(404); res.end(); }
});

const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD });

function rateLimited(ip) {
  const now = Date.now();
  let arr = rate.get(ip) || [];
  arr = arr.filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  rate.set(ip, arr);
  return arr.length > RATE_MAX;
}

wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) { try { ws.close(1013, 'rate_limited'); } catch {} return; }

  let room, role;
  try {
    const u = new URL(req.url, 'http://x');
    room = u.searchParams.get('room');
    role = u.searchParams.get('role');
  } catch { ws.close(); return; }

  if (!room || (role !== 'host' && role !== 'viewer')) { ws.close(); return; }
  ws.binaryType = 'nodebuffer';
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  if (role === 'host') {
    const prev = waitingHosts.get(room);
    if (prev && prev !== ws) { try { prev.close(); } catch {} }
    waitingHosts.set(room, ws);
    ws.on('close', () => { if (waitingHosts.get(room) === ws) waitingHosts.delete(room); });
    return;
  }

  // viewer
  const host = waitingHosts.get(room);
  if (!host || host.readyState !== 1) { try { ws.close(1013, 'host_unavailable'); } catch {} return; }
  waitingHosts.delete(room);
  pair(host, ws);
});

function pair(a, b) {
  const relay = (from, to) => (data) => {
    if (to.readyState !== 1) return;
    // 백프레셔: 상대 송신 버퍼가 임계 초과면 세션 종료(메모리 고갈 방지)
    if (to.bufferedAmount > BUFFER_LIMIT) { try { a.close(); } catch {} try { b.close(); } catch {} return; }
    to.send(data);
  };
  const aToB = relay(a, b);
  const bToA = relay(b, a);
  a.on('message', aToB);
  b.on('message', bToA);
  const closeBoth = () => { try { a.close(); } catch {} try { b.close(); } catch {} };
  a.on('close', closeBoth); b.on('close', closeBoth);
  a.on('error', closeBoth); b.on('error', closeBoth);
}

// ping/pong heartbeat: 30초마다, pong 미응답 소켓 강제 종료(좀비 정리)
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) { try { ws.terminate(); } catch {} return; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
  // rate 맵 청소
  const now = Date.now();
  for (const [ip, arr] of rate) {
    const f = arr.filter((t) => now - t < RATE_WINDOW_MS);
    if (f.length === 0) rate.delete(ip); else rate.set(ip, f);
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => console.log('RemoteDesktop relay listening on ' + PORT));
