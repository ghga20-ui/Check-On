# 모바일 자동 연결

Vercel 인증 엔드포인트: /api/auth/start, callback, session, logout.

Google 웹 클라이언트의 authorization code + PKCE + state로 offline 권한을 최초 1회 얻습니다. 리디렉션은 같은 운영 도메인의 callback으로 고정합니다. 갱신 토큰과 임시 접근 토큰은 AES-256-GCM 암호화된 __Host- 쿠키에 담으며 서버만 복호화합니다. HttpOnly/Secure/SameSite=Lax, 180일 비활성 만료, 토큰 갱신 시 연장합니다. 별도 토큰 데이터베이스나 출결 데이터 서버는 만들지 않습니다.

세션 API는 POST + 정확한 Origin + 커스텀 요청 헤더를 요구합니다. 전체 인증 응답은 no-store이며 서비스 워커 캐시/오프라인 대체에서 제외합니다. 응답 JSON에는 임시 접근 토큰만 포함합니다. 서버 비밀/갱신 토큰/원시 Google 오류는 응답과 로그에 남기지 않습니다. 서버는 학생 이름·출결 원문·기기 암호화 열쇠를 수신하지 않습니다.

만료 60초 전부터 자동 갱신하며 앱 시작/복귀/온라인 복귀/저장 직전에 복원합니다. 네트워크 실패는 30초 후 재시도하고 쿠키를 유지합니다. invalid_grant는 쿠키를 삭제하고 재연결을 안내합니다. 연결 해제는 Google 토큰 철회 성공 후 쿠키를 삭제하며, 철회 실패 시 성공한 것처럼 표시하지 않습니다. 다른 브라우저의 동일 Google 앱 권한도 Google의 철회 정책에 따라 해제될 수 있습니다.

운영 환경: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AUTH_ORIGIN, AUTH_COOKIE_KEY(32바이트 base64), VITE_SERVER_AUTH=true. 서버 비밀에는 VITE_ 접두사를 사용하지 않습니다. 키 교체 시 기존 연결 쿠키는 무효가 되므로 사용자가 재연결해야 합니다. 이전 프런트엔드 배포로 롤백하면 기존 수동 로그인 방식으로 돌아갑니다. Google 게시 상태는 프로덕션으로 확인했습니다.

검증: 모바일/인증 테스트 130개 통과. 상태 불일치/만료, 암호문 변조/키 불일치, CSRF, 네트워크 실패 보존, 실제 한 시간 경과를 가상 시계로 재현한 자동 갱신, 초기 앱 연결 복원, Google 철회 요청 및 토큰 비노출 검증 포함.

초기 전환 시 기존 사용자도 한번 Google 연결을 진행해야 합니다. 쿠키 삭제, Google 권한 취소, 조직 보안 정책 등에서는 다시 연결이 필요합니다. 삼성 인터넷의 설치 웹앱 쿠키 보존은 실기기 검증이 필요합니다.

운영 배포 완료: https://subjectteacherpwa.vercel.app (배포 AmWNWHpCFMTebHxfJFguCVjPX3Sw). start 303 + Secure/HttpOnly 쿠키, 미인증 session POST 401, 다른 Origin 403, session GET 405 확인. 추가 운영 JS 다운로드 검사는 네트워크 시간 초과로 완료하지 못했습니다. 서버 비밀은 서버 환경변수에서만 참조하고 프런트엔드 번들로 가져오지 않습니다. Google 계정 선택 화면 도달 확인; 실제 계정 동의와 삼성 인터넷의 장기 세션 유지는 사용자 기기에서 확인해야 합니다.
