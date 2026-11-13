# Digi Partner 푸시 서버

## 현재 구현
- Cloudflare Worker + D1 + Web Push
- 1분 간격 Cron으로 서버에 마지막 저장된 육성 상태를 계산
- 진화 예정 알림(설정한 분 단위)
- Ver.20th 배고픔/훈련 게이지 감소 및 알림
- Digimon X 배고픔/힘 게이지 감소 및 알림
- Ver.20th 야간 수면 안내(5분 간격, 최대 5회)
- Ver.20th 설정 기상 시각에 자동 기상 처리
- 테스트 푸시 및 구독 저장

서버는 물리 기기를 직접 읽을 수 없습니다. 앱에서 서버로 마지막 상태를 동기화한 뒤에만 앱이 닫혀 있는 동안 계산할 수 있습니다.

## Cloudflare 배포 전 준비
1. Cloudflare Worker 이름은 `digi-partner-server`, D1 바인딩은 `DB`입니다.
2. `wrangler.toml`의 D1 ID가 기존 `digi-partner-db`와 일치하는지 확인합니다.
3. D1 Console에서 `sql/schema.sql`을 실행합니다(이미 실행했다면 생략).
4. 로컬 프로젝트에서 `npm install`을 실행합니다.
5. `npm run generate-vapid`로 키를 생성합니다.

## Worker Secret
아래 명령을 실행하고 각 질문에 값을 입력합니다.

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
npx wrangler secret put APP_TOKEN
npx wrangler secret put ALLOWED_ORIGIN
```

- 공개 키: 생성된 VAPID 공개 키
- 개인 키: 생성된 VAPID 개인 키 JSON 전체. Worker Secret에만 저장합니다.
- Subject: 본인이 관리하는 이메일 주소를 `mailto:주소` 형식으로 입력
- APP_TOKEN: 길고 임의적인 비밀번호. 앱 연결 설정에도 입력해야 합니다.
- ALLOWED_ORIGIN: `https://yongsooo00.github.io`

## 배포 및 확인
```bash
npx wrangler deploy
```

배포 후 `https://digi-partner-server.wltjd3019.workers.dev/health`에서 `ok: true`를 확인합니다.

## 주의
- 아직 Worker 배포 및 iPhone 푸시 실전 테스트는 수행되지 않았습니다.
- 앱과 서비스 워커는 HTTPS에서 제공되어야 합니다.
- iPhone은 iOS 16.4 이상에서 Safari로 사이트를 홈 화면에 추가한 뒤 푸시 권한을 허용해야 합니다.
- `APP_TOKEN`을 정적 웹앱에 입력하면 브라우저에서 확인할 수 있으므로 공개 서비스의 강력한 인증 수단은 아닙니다. 개인용 테스트 용도로만 사용합니다.
- 서버는 마지막으로 동기화된 데이터를 계산합니다. 앱이 닫혀 있는 동안 물리 기기에서 발생한 변경을 서버가 스스로 알 수는 없습니다.
