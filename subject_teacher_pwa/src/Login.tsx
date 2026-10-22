import BrandMark from "./BrandMark";

interface LoginProps {
  onSignIn: () => void;
  busy?: boolean;
  error?: string;
  /** Set when VITE_GOOGLE_CLIENT_ID is missing — sign-in cannot proceed. */
  notConfigured?: boolean;
}

export default function Login({ onSignIn, busy, error, notConfigured }: LoginProps) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-mark" aria-hidden="true"><BrandMark size={52} /></div>
        <h1 className="brand-wordmark">체크온</h1>
        <p className="login-tagline">수업 직후, 스마트폰으로 1초 출결</p>

        <ul className="login-values">
          <li><i className="lv-check" aria-hidden="true">✓</i> 수업 끝나자마자 학번만 탭해서 출결</li>
          <li><i className="lv-check" aria-hidden="true">✓</i> 내 Google Drive에 자동 저장</li>
          <li><i className="lv-check" aria-hidden="true">✓</i> 오프라인에서도 입력 → 연결되면 자동 반영</li>
        </ul>

        {notConfigured ? (
          <p className="login-error">
            구글 클라이언트 ID가 설정되지 않았습니다. <code>.env.local</code>에
            <code>VITE_GOOGLE_CLIENT_ID</code>를 추가한 뒤 다시 실행하세요.
          </p>
        ) : (
          <>
            <button className="login-btn" type="button" onClick={onSignIn} disabled={busy}>
              {busy ? "연결 중…" : "Google 계정으로 시작하기"}
            </button>
            {error && <p className="login-error">{error}</p>}
            <p className="login-note">
              학생 이름은 Drive에 보내지 않습니다. 학번·출결 등은 본인 Google Drive에 저장하며,
              로그인 유지에는 인증 서버를 사용합니다. 실제 자료는 학교에서 허용한 범위 안에서 사용해 주세요.
            </p>
          </>
        )}
        <p><a className="policy-link" href="/getting-started.html">이용 안내</a> · <a className="policy-link" href="/school-guide.html">학교 담당자용 안내</a></p>
        <a className="policy-link" href="/privacy">개인정보처리방침</a>
      </div>
    </div>
  );
}
