/**
 * 운세 데이터 서비스 계층 (사용자 화면 전용, 읽기만 한다)
 * 화면은 운세를 이 서비스로만 받는다. 데이터 출처(TEST/PRODUCTION)가 바뀌어도 화면은 그대로다.
 *
 * 반환 형태
 *  { status, date, isMock, message, updatedAt, version, items[12](순위순), official:{url,publishedAt}|null }
 *  status: 'MOCK'(테스트 데이터) | 'PUBLISHED'(공개된 운세) | 'LINK_ONLY'(게시물 링크만 제공)
 *          | 'PENDING'(아직 없음) | 'NODATA'(과거 날짜에 기록 없음) | 'EXPIRED'(보관 기간 지남) | 'FUTURE' | 'ERROR'
 */
const HoroscopeRepo = {
  cacheKey_: function (mode, date) { return 'hs2:' + mode + ':' + date; },

  rowsForDate: function (date, mode) {
    return Db.readAll(CONFIG.SHEET.HOROSCOPES)
      .filter(function (r) { return r.horoscope_date === date && r.data_mode === mode; })
      .map(function (r) { r.rank = r.rank === '' ? '' : Number(r.rank); return r; });
  },

  /** 새 데이터가 저장되면 캐시를 비워서 사용자 화면이 바로 최신 내용을 받게 한다 */
  invalidate: function (date) {
    const c = CacheService.getScriptCache();
    c.remove(this.cacheKey_('TEST', date)); c.remove(this.cacheKey_('PRODUCTION', date));
  },

  officialPost: function (date, mode) {
    const rows = Db.readAll(CONFIG.SHEET.POSTS).filter(function (r) { return r.horoscope_date === date && r.data_mode === mode; });
    if (!rows.length) return null;
    rows.sort(function (a, b) { return a.published_at < b.published_at ? -1 : 1; });
    return { url: rows[0].post_url, publishedAt: rows[0].published_at };
  },

  /** 12건·별자리 중복 없음·순위 1~12 중복 없음 */
  isComplete: function (rows) {
    if (rows.length !== 12) return false;
    const s = {}, r = {};
    for (let i = 0; i < rows.length; i++) {
      const k = Number(rows[i].rank);
      if (ZODIAC_KEYS.indexOf(rows[i].zodiac_sign) < 0 || s[rows[i].zodiac_sign] || !(k >= 1 && k <= 12) || r[k]) return false;
      s[rows[i].zodiac_sign] = true; r[k] = true;
    }
    return true;
  },
};

const HoroscopeService = {

  today: function () { return nowParts_().date; },

  getByDate: function (dateStr) {
    const now = nowParts_();
    const date = dateStr || now.date;
    const fail = function (status, message) { return { status: status, date: date, items: [], isMock: false, message: message, official: null, version: status }; };

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('ERROR', '날짜 형식이 올바르지 않습니다.');
    if (date > now.date) return fail('FUTURE', '아직 지나지 않은 날짜예요.');
    const days = Settings.retentionDays();
    if (days && date < addDays_(now.date, -days)) return fail('EXPIRED', '보관 기간(' + days + '일)이 지난 날짜예요.');

    const mode = Settings.mode();
    const cache = CacheService.getScriptCache();
    const key = HoroscopeRepo.cacheKey_(mode, date);
    const hit = cache.get(key);
    if (hit) {
      const cached = JSON.parse(hit);
      // 시간에 따라 문구가 바뀌는 "아직 없음" 응답은 캐시에서 꺼낼 때 다시 계산한다
      if (cached.status !== 'PENDING') return cached;
    }

    let res;
    try { res = this.build_(date, mode, now); }
    catch (e) { return fail('ERROR', '데이터를 불러오지 못했습니다: ' + e.message); }
    try { cache.put(key, JSON.stringify(res), 60); } catch (e) { /* 캐시 실패는 무시 */ }
    return res;
  },

  build_: function (date, mode, now) {
    const official = HoroscopeRepo.officialPost(date, mode);
    const published = HoroscopeRepo.rowsForDate(date, mode).filter(function (r) { return r.publication_status === STATUS.PUBLISHED; });
    const ready = HoroscopeRepo.isComplete(published);

    if (mode === 'TEST') {
      if (ready) return this.pack_('MOCK', date, published, true, official);
      if (Settings.bool('TEST_FALLBACK', true)) return this.mockPack_(date, now);
      return this.pending_(date, now, official);
    }

    // PRODUCTION: 이용 허락(APPROVED)이 확인된 출처의, 검증·승인된 12건만 공개한다
    if (Source.authorization() !== 'APPROVED') {
      return official ? this.linkOnly_(date, official) : this.pending_(date, now, null);
    }
    if (ready) return this.pack_('PUBLISHED', date, published, false, official);

    // 오늘 운세가 아직 없으면 공식 사이트를 바로 한 번 확인해 본다 (10분에 한 번까지)
    if (Importer.fetchOnDemand_(date, now)) {
      const fresh = HoroscopeRepo.rowsForDate(date, mode).filter(function (r) { return r.publication_status === STATUS.PUBLISHED; });
      if (HoroscopeRepo.isComplete(fresh)) return this.pack_('PUBLISHED', date, fresh, false, HoroscopeRepo.officialPost(date, mode));
    }
    const res = this.pending_(date, now, HoroscopeRepo.officialPost(date, mode));
    if (res.status === 'PENDING') res.latestDate = this.latestPublishedBefore_(date, mode);
    return res;
  },

  /** date 이전에 볼 수 있는 가장 최근 운세 날짜 (최근 7일 안, 없으면 '') — "최근 운세 보기" 버튼용. 오늘 운세로 쓰지 않는다 */
  latestPublishedBefore_: function (date, mode) {
    const byDate = {};
    const oldest = addDays_(date, -7);
    Db.readAll(CONFIG.SHEET.HOROSCOPES).forEach(function (r) {
      if (r.data_mode === mode && r.publication_status === STATUS.PUBLISHED && r.horoscope_date < date && r.horoscope_date >= oldest) {
        (byDate[r.horoscope_date] = byDate[r.horoscope_date] || []).push(r);
      }
    });
    const days = Object.keys(byDate).filter(function (d) { return HoroscopeRepo.isComplete(byDate[d]); }).sort();
    return days.length ? days[days.length - 1] : '';
  },

  pack_: function (status, date, rows, isMock, official) {
    const items = rows.map(function (r) {
      return {
        zodiac_sign: r.zodiac_sign, rank: Number(r.rank), title_ko: '',
        content_ja: r.content_ja, content_ko: r.content_ko, lucky_item: r.lucky_item, lucky_color: r.lucky_color,
        source_name: r.source_name, source_url: r.source_post_url, source_published_at: r.source_published_at,
      };
    }).sort(function (a, b) { return a.rank - b.rank; });
    const updatedAt = rows.reduce(function (m, r) { return r.updated_at > m ? r.updated_at : m; }, '');
    return { status: status, date: date, isMock: isMock, message: '', updatedAt: updatedAt, version: status + '|' + updatedAt, items: items, official: official };
  },

  /** 저장된 테스트 데이터가 없을 때 즉석으로 만드는 가상 운세 (TEST_FALLBACK) */
  mockPack_: function (date, now) {
    const items = buildMockHoroscopes_(date).sort(function (a, b) { return a.rank - b.rank; });
    return { status: 'MOCK', date: date, isMock: true, message: '', updatedAt: date + ' 00:00:00', version: 'MOCKGEN|' + date, items: items, official: null };
  },

  pending_: function (date, now, official) {
    const isToday = date === now.date;
    const early = isToday && now.minutes < timeToMinutes_(CONFIG.FINAL_SLOT);
    return {
      status: isToday ? 'PENDING' : 'NODATA', date: date, items: [], isMock: false, official: official,
      message: isToday ? (early ? CONFIG.MSG_PENDING_EARLY : CONFIG.MSG_PENDING_FINAL) : '운세 기록 없음',
      version: (isToday ? 'PENDING' : 'NODATA') + '|' + (official ? official.url : ''),
    };
  },

  linkOnly_: function (date, official) {
    return {
      status: 'LINK_ONLY', date: date, items: [], isMock: false, official: official, updatedAt: official.publishedAt,
      message: '오늘의 오하아사 운세가 공식 게시물로 올라왔어요. 아래 링크에서 확인해 주세요.',
      version: 'LINK_ONLY|' + official.url,
    };
  },

  /** 달력에 점을 찍을 날짜들 (해당 월에서 운세를 볼 수 있는 날) */
  availableDates: function (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) return { dates: [], mock: false };
    const now = nowParts_(), mode = Settings.mode();
    const days = Settings.retentionDays();
    const oldest = days ? addDays_(now.date, -days) : '0000-00-00';
    const inRange = function (d) { return d <= now.date && d >= oldest && d.slice(0, 7) === month; };

    if (mode === 'TEST' && Settings.bool('TEST_FALLBACK', true)) {
      const all = []; for (let d = 1; d <= 31; d++) { const s = month + '-' + ('0' + d).slice(-2); if (inRange(s) && !isNaN(new Date(s))) all.push(s); }
      return { dates: all.filter(function (s) { return s.slice(0, 7) === month; }), mock: true, retentionDays: days };
    }
    const byDate = {};
    Db.readAll(CONFIG.SHEET.HOROSCOPES).forEach(function (r) {
      if (r.data_mode === mode && r.publication_status === STATUS.PUBLISHED && inRange(r.horoscope_date)) (byDate[r.horoscope_date] = byDate[r.horoscope_date] || []).push(r);
    });
    const ok = mode === 'PRODUCTION' && Source.authorization() !== 'APPROVED' ? [] :
      Object.keys(byDate).filter(function (d) { return HoroscopeRepo.isComplete(byDate[d]); }).sort();
    return { dates: ok, mock: mode === 'TEST', retentionDays: days };
  },
};
