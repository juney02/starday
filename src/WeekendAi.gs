/**
 * 별하루 AI 주말 운세 (토·일요일 전용)
 *
 * 오하아사는 토·일요일에 방송이 없어서 공식 운세가 올라오지 않는다.
 * 그날은 별하루가 "직접 만든" 재미용 운세를 보여준다. (다른 곳의 운세를 가져오지 않으므로 저작권 문제가 없다)
 *
 * 만드는 방법
 *  - 순위(1~12위)는 서버가 날짜를 씨앗으로 섞어서 정한다. (같은 날짜면 언제 만들어도 같은 순위 → 다시 시도해도 바뀌지 않음)
 *  - AI(Gemini)는 정해진 순위에 맞는 운세 문구·행운 아이템·행운 색상만 한국어로 쓴다.
 *  - 결과는 12별자리·순위·글자 수를 검사하고 통과한 것만 시트에 저장한다. (하루 한 번, 모든 방문자가 같은 결과를 본다)
 *
 * 지키는 원칙
 *  - 출처는 항상 "별하루 AI 주말 운세 (오하아사 아님)"으로 저장하고, 화면에도 AI가 만든 재미용 운세라고 표시한다.
 *  - 오하아사 공식 자료가 있는 날짜에는 만들지 않고, 공식 자료를 덮어쓰지 않는다. (반대로 공식 자료는 AI 운세를 대신할 수 있다)
 *  - 주말(토·일) 오늘 날짜만 만든다. 지난 날짜나 평일 운세를 AI로 채우지 않는다.
 *  - 실패하면 아무것도 저장하지 않는다. (10분 뒤 다시 시도)
 */
const WeekendAi = {

  /** 주말인지 (날짜 문자열 기준, 한국 날짜) */
  isWeekend: function (date) {
    const p = String(date).split('-').map(Number);
    const day = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
    return day === 0 || day === 6;
  },

  enabled: function () { return Settings.bool('WEEKEND_AI', true) && Settings.has('GEMINI_API_KEY'); },

  /** 지금 이 날짜에 AI 주말 운세를 만들어도 되는지 */
  applies: function (date, now) {
    return Settings.mode() === 'PRODUCTION' && this.isWeekend(date) && date === now.date && now.minutes >= timeToMinutes_(CONFIG.ON_DEMAND_FROM);
  },

  /**
   * 그날 운세가 없으면 만들어 저장한다.
   * @return {boolean} 이 날짜에 볼 수 있는 운세(12건)가 있으면 true
   */
  ensure: function (date, trigger) {
    if (!this.enabled()) return false;
    const ready = function () {
      return HoroscopeRepo.isComplete(HoroscopeRepo.rowsForDate(date, 'PRODUCTION').filter(function (r) { return r.publication_status === STATUS.PUBLISHED; }));
    };
    if (ready()) return true;
    const cache = CacheService.getScriptCache(), key = 'WAI:' + date;
    if (cache.get(key)) return false;                  // 최근에 시도했음 (실패 후 10분 쉬기)
    cache.put(key, '1', CONFIG.ON_DEMAND_GAP_SEC);

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return false;
    const log = {
      id: Utilities.getUuid(), source_name: CONFIG.AI_WEEKEND_SOURCE, started_at: stamp_(), trigger: 'AI_WEEKEND ' + (trigger || ''),
      data_mode: 'PRODUCTION', checked_post_ids: 'ai-weekend-' + date, records_found: 0, valid_records: 0, error_message: '',
    };
    try {
      if (ready()) return true;
      const existing = HoroscopeRepo.rowsForDate(date, 'PRODUCTION');
      if (existing.some(function (r) { return r.source_name !== CONFIG.AI_WEEKEND_SOURCE; })) {
        log.import_status = 'SKIPPED'; log.error_message = '이 날짜에는 공식 자료가 있어 AI 운세를 만들지 않아요.';
        return false;
      }
      const items = this.generate_(date);
      this.save_(date, items, existing);
      HoroscopeRepo.invalidate(date);
      log.import_status = 'SUCCESS'; log.records_found = 12; log.valid_records = 12; log.error_message = 'AI 주말 운세를 만들어 공개했어요.';
      return true;
    } catch (e) {
      log.import_status = 'FAILED';
      let m = String(e && e.message ? e.message : e);
      const k = Settings.get('GEMINI_API_KEY', '');
      if (k) m = m.split(k).join('***');
      log.error_message = 'AI 주말 운세 실패: ' + m.slice(0, 250);
      return false;
    } finally {
      if (log.import_status) { try { log.completed_at = stamp_(); Db.append(CONFIG.SHEET.LOGS, log); } catch (e) { /* 로그 실패는 무시 */ } }
      lock.releaseLock();
    }
  },

  /** 날짜를 씨앗으로 12별자리 순위를 섞는다 (같은 날짜 → 같은 순위) */
  ranking: function (date) {
    let h = 2166136261;
    const s = 'byeolharu-weekend-' + date;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const rnd = function () {               // mulberry32
      h = (h + 0x6D2B79F5) >>> 0;
      let t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const signs = ZODIAC_KEYS.slice();
    for (let i = signs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const tmp = signs[i]; signs[i] = signs[j]; signs[j] = tmp; }
    const out = {};
    signs.forEach(function (k, i) { out[k] = i + 1; });
    return out;
  },

  /** AI에게 문구를 받아 검사한다. 형식이 틀리면 한 번 더 시도한다 */
  generate_: function (date) {
    const ranks = this.ranking(date);
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return this.parse_(this.ask_(date, ranks), ranks); }
      catch (e) { lastErr = e; }
    }
    throw lastErr;
  },

  ask_: function (date, ranks) {
    const dayKo = new Date(date + 'T00:00:00Z').getUTCDay() === 6 ? '토요일' : '일요일';
    const list = ZODIAC_KEYS.slice().sort(function (a, b) { return ranks[a] - ranks[b]; })
      .map(function (k) { return ranks[k] + '위: ' + ZODIAC_KO[k] + ' (' + k + ')'; }).join('\n');
    const system = [
      '너는 별자리 운세 앱 "별하루"의 운세 작가야. 주말에 볼 재미용 12별자리 운세를 한국어로 써.',
      '규칙:',
      '1. 순위는 주어진 그대로 쓰고 바꾸지 마. 순위가 높을수록 밝고 기분 좋은 운세, 낮을수록 부드러운 주의와 작은 팁을 줘. 낮은 순위도 겁주거나 불길하게 쓰지 마.',
      '2. content는 존댓말 아닌 다정한 반말로 2문장, 40~90자. 첫 문장은 오늘의 핵심 한 줄, 둘째 문장은 구체적인 행동 팁.',
      '3. lucky_item은 일상에서 볼 수 있는 물건이나 음식 하나(15자 이내), lucky_color는 색 이름 하나(10자 이내, 예: 하늘색).',
      '4. 건강·돈·시험 결과를 장담하거나 의학·투자 조언을 하지 마. 특정 TV 프로그램, 오하아사, 실존 인물, 브랜드를 언급하지 마.',
      '5. 12별자리가 서로 다른 내용이 되게 써. 마크다운, 이모지는 쓰지 마.',
      '출력: JSON 배열만. 각 원소는 {"sign": 영문 식별자, "content": 문구, "lucky_item": 아이템, "lucky_color": 색}.',
    ].join('\n');
    const res = AiAgent.callGemini_({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: date + ' (' + dayKo + ') 운세를 써 줘. 순위:\n' + list }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: AI_LIMITS.OUTPUT_TOKENS, responseMimeType: 'application/json' },
    });
    const cand = res.candidates && res.candidates[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    const text = parts.filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ''; }).join('').trim();
    if (!text) throw new Error('빈 응답 (' + ((cand && cand.finishReason) || '이유 없음') + ')');
    return text;
  },

  /** AI 답(JSON 글자) → 검사된 12개 항목. 하나라도 이상하면 오류 */
  parse_: function (text, ranks) {
    let arr;
    try { arr = JSON.parse(String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()); }
    catch (e) { throw new Error('AI 답이 JSON 형식이 아니에요.'); }
    if (arr && !Array.isArray(arr) && Array.isArray(arr.items)) arr = arr.items;
    if (!Array.isArray(arr)) throw new Error('AI 답이 목록 형식이 아니에요.');
    const clean = function (v, max) { return sanitizeAiText_(v).replace(/\s+/g, ' ').trim().slice(0, max); };
    const seen = {}, out = [];
    arr.forEach(function (o) {
      if (!o || typeof o !== 'object') return;
      const sign = String(o.sign || '').trim().toLowerCase();
      if (ZODIAC_KEYS.indexOf(sign) < 0 || seen[sign]) return;
      const content = clean(o.content, 200), item = clean(o.lucky_item, 30), color = clean(o.lucky_color, 20);
      if (content.length < 10 || !item || !color) return;
      seen[sign] = true;
      out.push({ sign: sign, rank: ranks[sign], content_ko: content, lucky_item: item, lucky_color: color });
    });
    if (out.length !== 12) throw new Error('AI 답에서 올바른 별자리 운세가 ' + out.length + '개뿐이에요. (12개 필요)');
    return out;
  },

  save_: function (date, items, existing) {
    const now = stamp_(), bySign = {};
    existing.forEach(function (r) { bySign[r.zodiac_sign] = r; });
    items.forEach(function (it) {
      const row = {
        horoscope_date: date, zodiac_sign: it.sign, rank: it.rank, content_ja: '', content_ko: it.content_ko,
        lucky_item: it.lucky_item, lucky_item_ja: '', lucky_color: it.lucky_color, lucky_color_ja: '',
        source_name: CONFIG.AI_WEEKEND_SOURCE, source_post_id: 'ai-weekend-' + date, source_post_url: '', source_published_at: now,
        translation_status: 'NONE', validation_status: 'VALID', validation_note: 'AI가 만든 재미용 주말 운세 (오하아사 아님)',
        publication_status: STATUS.PUBLISHED, data_mode: 'PRODUCTION', edited_by_admin: '', updated_at: now,
      };
      const ex = bySign[it.sign];
      if (ex) Db.update(CONFIG.SHEET.HOROSCOPES, ex._row, row);
      else { row.id = Utilities.getUuid(); row.created_at = now; Db.append(CONFIG.SHEET.HOROSCOPES, row); }
    });
  },
};
