/**
 * X(트위터) 공식 API v2 클라이언트
 *
 * - 인증: 스크립트 속성 X_BEARER_TOKEN (코드나 화면에 절대 노출하지 않는다)
 * - 공식 API만 사용한다. 로그인 우회·크롤링·스크래핑은 하지 않는다.
 * - 접근 권한이 없으면(401/403) 즉시 멈추고 오류로 기록한다. → 수동 입력 모드로 운영한다.
 *
 * ※ X API는 플랜(무료/Basic/Pro 등)에 따라 "다른 사용자의 게시물 읽기" 가능 여부, 월 호출 한도, 요금이 다르고
 *   자주 바뀝니다. 반드시 X 개발자 포털(https://developer.x.com)에서 현재 플랜의 권한·요금·한도를 확인하세요.
 */
const X_API_BASE = 'https://api.x.com/2';

function XError_(code, message, extra) {
  const e = new Error(message);
  e.xcode = code;       // AUTH | FORBIDDEN | RATE_LIMIT | SERVER | NETWORK | NOT_FOUND | BAD_RESPONSE
  e.extra = extra || {};
  return e;
}

const XClient = {
  /** GET 호출. 일시적 장애(5xx/네트워크)는 2초, 4초 간격으로 최대 2번만 재시도한다. */
  call_: function (path, params) {
    const token = Settings.get('X_BEARER_TOKEN', '');
    if (!token) throw XError_('AUTH', 'X_BEARER_TOKEN이 설정되지 않았어요. (스크립트 속성에 등록 필요)');

    const qs = Object.keys(params || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    const url = X_API_BASE + path + (qs ? '?' + qs : '');
    const waits = [2000, 4000];
    let lastErr = null;

    for (let attempt = 0; attempt <= waits.length; attempt++) {
      try {
        const res = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
        const code = res.getResponseCode();
        const body = res.getContentText();
        if (code === 200) {
          try { return JSON.parse(body); } catch (e) { throw XError_('BAD_RESPONSE', 'X API 응답을 해석하지 못했어요.'); }
        }
        if (code === 401) throw XError_('AUTH', 'X API 인증 실패(401). 토큰이 올바른지 확인하세요.');
        if (code === 403) throw XError_('FORBIDDEN', 'X API 접근 거부(403). 현재 플랜에서 게시물 조회 권한이 없을 수 있어요. 개발자 포털에서 권한을 확인하세요.');
        if (code === 404) throw XError_('NOT_FOUND', 'X API: 대상을 찾지 못했어요(404).');
        if (code === 429) {
          const reset = res.getHeaders()['x-rate-limit-reset'] || res.getHeaders()['X-Rate-Limit-Reset'] || '';
          throw XError_('RATE_LIMIT', 'X API 호출 한도를 초과했어요(429). 다음 확인 때 다시 시도합니다.', { reset: reset }); // 한도 초과는 재시도하지 않는다
        }
        if (code >= 500) { lastErr = XError_('SERVER', 'X API 서버 오류(' + code + ').'); }
        else throw XError_('BAD_RESPONSE', 'X API 오류(' + code + '): ' + body.slice(0, 200));
      } catch (e) {
        if (e.xcode && e.xcode !== 'SERVER') throw e;      // 재시도 대상이 아닌 오류
        lastErr = e.xcode ? e : XError_('NETWORK', '네트워크 오류: ' + e.message);
      }
      if (attempt < waits.length) Utilities.sleep(waits[attempt]);
    }
    throw lastErr;
  },

  getUserId: function (username) {
    const cached = Source.get().x_user_id;
    if (cached) return String(cached);
    const res = this.call_('/users/by/username/' + encodeURIComponent(username), {});
    if (!res.data || !res.data.id) throw XError_('NOT_FOUND', '@' + username + ' 계정을 찾지 못했어요.');
    Source.patch({ x_user_id: String(res.data.id) });
    return String(res.data.id);
  },

  /** 최신 게시물(리포스트·답글 제외)을 공통 형식으로 반환 */
  getRecentPosts: function (username) {
    const userId = this.getUserId(username);
    const res = this.call_('/users/' + userId + '/tweets', {
      max_results: 20,
      exclude: 'retweets,replies',
      'tweet.fields': 'created_at,author_id,conversation_id,attachments,referenced_tweets,lang',
      expansions: 'attachments.media_keys',
      'media.fields': 'type,url,preview_image_url,alt_text',
    });
    const mediaByKey = {};
    ((res.includes && res.includes.media) || []).forEach(function (m) { mediaByKey[m.media_key] = m; });

    return (res.data || []).map(function (t) {
      const refs = t.referenced_tweets || [];
      const keys = (t.attachments && t.attachments.media_keys) || [];
      return {
        id: String(t.id), text: t.text || '', created_at: t.created_at, author_id: String(t.author_id || userId),
        url: 'https://x.com/' + username + '/status/' + t.id,
        is_retweet: refs.some(function (r) { return r.type === 'retweeted'; }),
        media: keys.map(function (k) { const m = mediaByKey[k] || {}; return { type: m.type || '', url: m.url || m.preview_image_url || '', alt: m.alt_text || '' }; }),
      };
    }).sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
  },
};
