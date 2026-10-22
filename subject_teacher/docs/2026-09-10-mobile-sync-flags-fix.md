# 모바일 나이스 반영 후 추가 수정 오류 수정

사용자 재현: 모바일에서 1명 결과 저장 → PC NEIS 반영 → 같은 수업에 3명 추가 저장 시 충돌 오류.
원인: 모바일 충돌 비교에 syncedToNeis/closedOnNeis까지 포함되어 PC의 반영 상태 갱신을 출결 변경으로 오인.
수정: 출결 내용·checkedAt·source·명부 ID/버전은 비교하고 반영 상태 두 필드만 제외. 새 수정 저장은 반영·마감 플래그를 false로 초기화. 이미 성공한 전송 재시도는 PC가 갱신한 플래그를 보존.
회귀 재현 2개 실패 확인 후 수정. 실제 다른 출결 변경 및 같은 내용의 새로운 확인 시각은 여전히 충돌 처리. ETag 412 보호 유지.
관련 테스트 23개 통과. 운영 빌드 성공.
배포 소스 cfb90444f32949520d373196e2376f28b9788e19 / codex/mobile-sync-flags-fix.
운영: https://subjectteacherpwa.vercel.app
배포: https://subjectteacher-moa6xc40t-sejunparks-projects-fcff9bbd.vercel.app
기존 1.0.9 배포 소스에서 수정 파일 2개만 적용. 다른 미배포 작업은 포함하지 않음.
새로고침 후 기존 미전송 기록 재시도 가능. 학생 실제 자료를 도구로 수정하지 않음. PC 설치본 변경 없음.
