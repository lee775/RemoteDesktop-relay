# RemoteDesktop Relay

두 PC가 서로 다른 인터넷(CGNAT 포함)에 있어도 연결되도록, 각 PC가 **바깥으로만** 접속해 만나는 WebSocket 릴레이입니다.

- 화면 데이터는 앱에서 **종단간 TLS**로 암호화 → 릴레이는 암호문만 중계(내용 못 봄)
- room(=기기 ID) 기준으로 host/viewer 를 페어링해 바이너리를 그대로 전달
- 포트포워딩/SSH 터널링 불필요

## Render.com 무료 배포 (신용카드 불필요)

1. https://render.com 가입 (GitHub 계정으로 로그인 가능)
2. **New +** → **Web Service**
3. **Public Git repository** 에 이 저장소 URL 입력: `https://github.com/lee775/RemoteDesktop-relay`
   (또는 본인 GitHub 에 fork/clone 후 연결)
4. 설정 확인: Runtime=Node, Build=`npm install`, Start=`node server.js`, Plan=**Free**
5. **Create Web Service** → 배포 완료되면 URL 확인 (예: `https://remotedesktop-relay-xxxx.onrender.com`)

배포 후 그 URL 을 알려주시면 앱이 자동으로 사용하도록 연결합니다.
(앱은 `wss://remotedesktop-relay-xxxx.onrender.com/ws` 형태로 접속합니다)

## 로컬 실행(테스트)

```
npm install
node server.js   # 기본 8080 포트
```

## 참고
- Render 무료 플랜은 유휴 시 슬립 → 첫 접속 시 30~50초 콜드스타트가 있을 수 있습니다.
  공유 중에는 호스트가 상시 연결을 유지하므로 깨어 있습니다.
