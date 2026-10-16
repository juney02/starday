/**
 * 일본어 → 한국어 번역 (서버에서만 호출, 키는 스크립트 속성 ANTHROPIC_API_KEY)
 *
 * - TEST 모드: 외부 API 없이 가상 게시물 전용 사전으로 번역을 흉내 낸다.
 * - PRODUCTION 모드: 출처 이용 허락 상태가 APPROVED이고 API 키가 있을 때만 번역한다. 아니면 번역하지 않는다.
 * - 번역은 원문 의미 유지가 원칙이고 순위·별자리 이름은 건드리지 않는다. (번역 대상은 설명/행운 아이템/행운 색상뿐)
 */
const Translator = {
  /**
   * items(sign, content_ja, lucky_item_ja, lucky_color_ja)에 content_ko, lucky_item, lucky_color를 채운다.
   * @return {{status:'DONE'|'NONE'|'REVIEW'|'FAILED', note:string}}
   */
  translate: function (items, mode, authorization) {
    if (!items.length) return { status: 'NONE', note: '번역할 항목이 없어요.' };

    if (mode === 'TEST') {
      const dict = TestFeed.translations();
      let miss = 0;
      items.forEach(function (it) {
        it.content_ko = it.content_ja ? (dict[it.content_ja] || '') : '';
        it.lucky_item = it.lucky_item_ja ? (dict[it.lucky_item_ja] || '') : '';
        it.lucky_color = it.lucky_color_ja ? (dict[it.lucky_color_ja] || '') : '';
        if ((it.content_ja && !it.content_ko) || (it.lucky_item_ja && !it.lucky_item) || (it.lucky_color_ja && !it.lucky_color)) miss++;
      });
      return miss ? { status: 'REVIEW', note: '사전에 없는 문장이 ' + miss + '건 있어요.' } : { status: 'DONE', note: 'TEST 사전 번역' };
    }

    if (authorization !== 'APPROVED') return { status: 'NONE', note: '출처 이용 허락(APPROVED)이 없어 번역하지 않았어요.' };
    const key = Settings.get('ANTHROPIC_API_KEY', '');
    if (!key) return this.googleTranslate_(items);   // Claude 키가 없으면 Apps Script 내장(무료) 번역을 쓴다

    try {
      const out = this.callClaude_(items, key);
      const bySign = {};
      out.forEach(function (o) { bySign[o.sign] = o; });
      let bad = 0;
      items.forEach(function (it) {
        const o = bySign[it.sign];
        if (!o) { bad++; return; }
        it.content_ko = String(o.content || '').trim();
        it.lucky_item = String(o.lucky_item || '').trim();
        it.lucky_color = String(o.lucky_color || '').trim();
        if (it.content_ja && !it.content_ko) bad++;
      });
      return bad ? { status: 'REVIEW', note: '번역 결과 ' + bad + '건이 비었어요. 검수가 필요해요.' } : { status: 'DONE', note: 'AI 번역' };
    } catch (e) {
      return { status: 'FAILED', note: '번역 실패: ' + e.message };
    }
  },

  /** Apps Script 내장 Google 번역(키 필요 없음). 품질은 Claude보다 낮을 수 있어 관리자 화면에서 확인·수정할 수 있다. */
  googleTranslate_: function (items) {
    try {
      const tr = function (text) { return text ? String(LanguageApp.translate(text, 'ja', 'ko')).trim() : ''; };
      items.forEach(function (it) {
        it.content_ko = tr(it.content_ja);
        it.lucky_item = tr(it.lucky_item_ja);
        it.lucky_color = tr(it.lucky_color_ja);
      });
      return { status: 'DONE', note: 'Google 번역(자동, 품질 확인 권장)' };
    } catch (e) {
      return { status: 'FAILED', note: '번역 실패: ' + e.message };
    }
  },

  callClaude_: function (items, key) {
    const system = [
      'You are a careful Japanese-to-Korean translator for daily horoscope text.',
      'Translate each field into natural Korean while keeping the original meaning exactly.',
      'Do NOT add, exaggerate, or invent anything. Do NOT change star sign keys or ranks.',
      'Translate lucky items and colors accurately (e.g. 青いノート -> 파란 노트).',
      'If a source field is empty, return an empty string for it.',
      'Reply with JSON only, no explanations: {"items":[{"sign":"<same key>","content":"","lucky_item":"","lucky_color":""}]}',
    ].join('\n');
    const payload = items.map(function (it) { return { sign: it.sign, content: it.content_ja || '', lucky_item: it.lucky_item_ja || '', lucky_color: it.lucky_color_ja || '' }; });
    const body = {
      model: Settings.get('TRANSLATE_MODEL', 'claude-sonnet-5-5'), max_tokens: 4000, system: system,
      messages: [{ role: 'user', content: JSON.stringify({ items: payload }) }],
    };
    return anthropicJson_(body).items || [];
  },
};

/** Claude Messages API 호출 → 응답 텍스트를 JSON으로 해석. 일시적 오류는 1번만 재시도. */
function anthropicJson_(body) {
  const key = Settings.get('ANTHROPIC_API_KEY', '');
  if (!key) throw new Error('ANTHROPIC_API_KEY가 없어요.');
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, payload: JSON.stringify(body),
      });
    } catch (e) { lastErr = new Error('네트워크 오류: ' + e.message); Utilities.sleep(3000); continue; }
    const code = res.getResponseCode();
    if (code === 200) {
      const data = JSON.parse(res.getContentText());
      let text = (data.content && data.content[0] && data.content[0].text) || '';
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      return JSON.parse(text);
    }
    lastErr = new Error('Claude API 오류(' + code + ')');
    if (code === 429 || code >= 500) { Utilities.sleep(3000); continue; }
    break;
  }
  throw lastErr;
}
