/**
 * 자동 수집 파이프라인 + 스케줄러
 *
 * 수집 경로 (모드에 따라 자동 선택)
 *   TEST 모드        : 가상 X 게시물(TestFeed)
 *   PRODUCTION + SITE: 공식 사이트의 horoscope.json (기본값. X API 비용 없이 사용)
 *   PRODUCTION + X   : X 공식 API (X_BEARER_TOKEN 필요)
 *
 * 흐름: 수집 → (분류) → 출처 메타데이터 기록 → (이용 허락 APPROVED일 때만) 분석 → 검증 → 번역 → 저장 → 공개 여부 결정 → 로그
 *
 * 안전 원칙
 *  - 오류가 나도 기존에 저장된 데이터는 지우거나 바꾸지 않는다. (저장은 모든 단계가 끝난 뒤 마지막에만 한다)
 *  - 이미 공개(PUBLISHED)됐거나 관리자가 수정한 행은 자동으로 덮어쓰지 않는다.
 *  - 오늘 날짜의 운세가 아니면 저장하지 않는다. (이전 날짜 운세를 오늘 것으로 쓰지 않음)
 *  - 동시에 두 번 실행돼도 LockService로 한 번에 하나만 처리한다.
 */
const Importer = {

  /**
   * @param {string} trigger 'AUTO 08:00' | 'MANUAL' 등 (로그용)
   * @param {{force?:boolean}} opts force: 이미 받은 데이터가 있어도 다시 확인
   */
  run: function (trigger, opts) {
    opts = opts || {};
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return { status: 'BUSY', message: '다른 확인 작업이 실행 중이에요. 잠시 뒤 다시 시도해 주세요.' };

    const mode = Settings.mode();
    const log = {
      id: Utilities.getUuid(), source_name: this.sourceName_(mode), started_at: stamp_(), trigger: trigger, data_mode: mode,
      checked_post_ids: '', records_found: 0, valid_records: 0, error_message: '',
    };
    let result;
    const today = nowParts_().date;
    try {
      result = this.process_(today, mode, opts, log);
    } catch (e) {
      result = { status: 'FAILED', message: (e.xcode ? '[' + e.xcode + '] ' : '') + e.message };
    }
    // 방금 확인했으니 "앱을 열 때 바로 확인"은 잠시 쉰다. 사이트가 막거나(403) 많다고 하면(429) 6시간 쉰다
    try {
      const stop = /FORBIDDEN|RATE_LIMIT/.test(String(result.message || ''));
      CacheService.getScriptCache().put('OD:' + today, stop ? 'stop' : '1', stop ? 6 * 3600 : CONFIG.ON_DEMAND_GAP_SEC);
    } catch (e) { /* 캐시 실패는 무시 */ }
    try {
      log.import_status = result.status;
      log.completed_at = stamp_();
      if (result.message) log.error_message = result.message;
      if (result.records) { log.records_found = result.records.found; log.valid_records = result.records.valid; }
      Db.append(CONFIG.SHEET.LOGS, log);
    } catch (e) { /* 로그 저장 실패가 본 작업을 망치지 않게 한다 */ }
    lock.releaseLock();
    return result;
  },

  /** 수집 경로: 'TEST' | 'SITE' | 'X' */
  origin_: function (mode) {
    if (mode === 'TEST') return 'TEST';
    return Settings.get('PROD_SOURCE', 'SITE') === 'X' ? 'X' : 'SITE';
  },
  sourceName_: function (mode) {
    const o = this.origin_(mode);
    return o === 'TEST' ? CONFIG.TEST_SOURCE_NAME : (o === 'SITE' ? CONFIG.SITE_SOURCE_NAME : CONFIG.SOURCE_NAME);
  },

  process_: function (today, mode, opts, log) {
    Source.get();
    Source.patch({ last_checked_at: stamp_() });
    const auth = String(Source.authorization());

    // 이미 완전히 검증된 12건이 있으면 다시 저장하지 않는다
    const existing = HoroscopeRepo.rowsForDate(today, mode);
    // (AI 주말 운세는 "완료"로 치지 않는다 → 공식 자료가 올라오면 공식 자료로 바뀐다)
    const complete = existing.length === 12 && existing.every(function (r) { return r.validation_status === 'VALID' && r.source_name !== CONFIG.AI_WEEKEND_SOURCE; });
    if (complete && !opts.force) return { status: 'SKIPPED', message: '오늘 데이터가 이미 저장되어 있어요.' };

    return this.origin_(mode) === 'SITE'
      ? this.fromSite_(today, mode, auth, existing, log)
      : this.fromPosts_(today, mode, auth, existing, log);
  },

  /* ---------- 경로 1: 공식 사이트 ---------- */
  fromSite_: function (today, mode, auth, existing, log) {
    const feed = SiteClient.fetchHoroscope();
    log.checked_post_ids = 'ohaasa-' + feed.id;
    Settings.set('SITE_LATEST_DATE', feed.date);
    if (feed.date !== today) {
      const msg = '공식 사이트의 최신 운세는 ' + feed.date + ' 자료예요. 오늘(' + today + ') 운세는 아직 올라오지 않았어요.';
      const kept = this.backfill_(feed, today, mode, auth);
      return { status: 'NO_POST', message: msg + (kept ? ' (' + feed.date + ' 운세는 그 날짜의 기록으로 저장했어요)' : '') };
    }
    const head = { id: 'ohaasa-' + feed.id, url: OFFICIAL_PAGE_URL, created_at: new Date().toISOString() };
    this.recordPosts_([{ post: { id: head.id, url: head.url, created_at: head.created_at, media: [] }, kind: 'HOROSCOPE' }], today, mode);

    if (auth !== 'APPROVED') return this.linkOnly_(today);   // 이용 허락 전: 내용은 저장하지 않고 링크만
    return this.finish_(today, mode, auth, existing, { date: feed.date, items: feed.items, warnings: feed.warnings }, head, false, true);
  },

  /* ---------- 경로 2: 게시물(TEST 가상 게시물 / X API) ---------- */
  fromPosts_: function (today, mode, auth, existing, log) {
    const src = Source.get();
    let posts, authorId;
    if (mode === 'TEST') {
      posts = TestFeed.getPosts(today, Settings.get('TEST_SCENARIO', 'normal'));
      authorId = TEST_AUTHOR_ID;
    } else {
      posts = XClient.getRecentPosts(src.source_username || CONFIG.DEFAULT_USERNAME);
      authorId = String(Source.get().x_user_id);
    }
    log.checked_post_ids = posts.map(function (p) { return p.id; }).join(',');

    // 분류: 리포스트 / 다른 계정 / 오늘이 아닌 게시물 제외
    const candidates = [];
    posts.forEach(function (p) {
      const c = Importer.classify_(p, authorId, today);
      if (c === 'HOROSCOPE' || c === 'IMAGE') candidates.push({ post: p, kind: c });
    });
    if (!candidates.length) return { status: 'NO_POST', message: '오늘 날짜의 운세 게시물을 아직 찾지 못했어요.' };

    // 출처 메타데이터 기록 (이용 허락과 상관없이 허용되는 정보: 게시물 ID·링크·게시 시각)
    this.recordPosts_(candidates, today, mode);
    const head = candidates[0].post;

    if (mode === 'PRODUCTION' && auth !== 'APPROVED') return this.linkOnly_(today);

    // 분석
    let parsed = parseHoroscopeText_(candidates.filter(function (c) { return c.kind === 'HOROSCOPE'; })
      .map(function (c) { return c.post.text; }).join('\n'), today);
    let fromImage = false;

    if (!parsed.items.length) {
      const imageUrls = [];
      candidates.forEach(function (c) { c.post.media.forEach(function (m) { if (m.type === 'photo' && m.url) imageUrls.push(m.url); }); });
      if (mode === 'PRODUCTION' && ImageOcr.enabled() && imageUrls.length) { parsed = ImageOcr.extract(imageUrls); fromImage = true; }
      if (!parsed.items.length) {
        return { status: 'IMAGE_ONLY', message: '이미지로 올라온 게시물이에요. 이미지 분석이 꺼져 있거나 실패해서, 관리자가 직접 입력해야 해요.' };
      }
    }
    const authorOk = candidates.every(function (c) { return c.post.author_id === authorId; });
    return this.finish_(today, mode, auth, existing, parsed, head, fromImage, authorOk);
  },

  /**
   * 공식 사이트에 아직 지난 날짜(최근 BACKFILL_DAYS일 안) 운세가 걸려 있으면, 그 운세를 "원래 날짜"의 기록으로 저장한다.
   * (예: 처음 설정한 날이 주말이면 금요일 운세를 금요일 기록으로 남긴다. 오늘 운세로 쓰는 것이 아니다)
   * 그 날짜에 이미 검증된 12건이 있거나 이용 허락 전이면 아무것도 하지 않는다.
   */
  backfill_: function (feed, today, mode, auth) {
    if (auth !== 'APPROVED' || feed.date >= today || feed.date < addDays_(today, -CONFIG.BACKFILL_DAYS)) return false;
    const existing = HoroscopeRepo.rowsForDate(feed.date, mode);
    if (existing.length === 12 && existing.every(function (r) { return r.validation_status === 'VALID'; })) return false;
    const head = { id: 'ohaasa-' + feed.id, url: OFFICIAL_PAGE_URL, created_at: new Date().toISOString() };
    const r = this.finish_(feed.date, mode, auth, existing, { date: feed.date, items: feed.items, warnings: feed.warnings }, head, false, true);
    return r.status === 'SUCCESS' || r.status === 'REVIEW';
  },

  /**
   * 사용자가 앱을 열었는데 오늘 운세가 없을 때 그 자리에서 공식 사이트를 한 번 확인한다.
   * - 운영 모드 + 공식 사이트 경로 + 이용 허락(APPROVED)일 때만, 아침 ON_DEMAND_FROM 이후에만
   * - 10분(ON_DEMAND_GAP_SEC)에 한 번까지만 (사이트에 부담을 주지 않게)
   * - 사이트가 막거나(403) 너무 많다고 하면(429) 6시간 동안 다시 묻지 않는다 (우회하지 않음)
   * @return {boolean} 새로 공개된 데이터가 생겼으면 true
   */
  fetchOnDemand_: function (date, now) {
    if (!Settings.bool('ON_DEMAND_FETCH', true)) return false;
    if (Settings.mode() !== 'PRODUCTION' || this.origin_('PRODUCTION') !== 'SITE') return false;
    if (date !== now.date || now.minutes < timeToMinutes_(CONFIG.ON_DEMAND_FROM)) return false;
    if (!Source.enabled() || Source.authorization() !== 'APPROVED') return false;
    if (CacheService.getScriptCache().get('OD:' + date)) return false;   // 최근에 확인했음 (run이 기록)
    return this.run('ON_DEMAND', {}).status === 'SUCCESS';
  },

  linkOnly_: function (today) {
    Source.patch({ last_success_at: stamp_() });
    HoroscopeRepo.invalidate(today);
    return { status: 'LINK_ONLY', message: '운세를 확인했어요. 이용 허락(APPROVED) 전이라 링크만 제공합니다.' };
  },

  /** 검증 → 번역 → 공개 여부 결정 → 저장 (두 경로 공통) */
  finish_: function (today, mode, auth, existing, parsed, head, fromImage, authorOk) {
    const validation = validateHoroscope_(parsed.items, {
      expectedDate: today, parsedDate: parsed.date, authorOk: authorOk, warnings: parsed.warnings, fromImage: fromImage,
    });

    // 번역 (검증에 실패한 데이터는 번역하지 않는다)
    const tr = validation.status === 'INVALID' ? { status: 'NONE', note: '검증 실패로 번역하지 않음' } : Translator.translate(parsed.items, mode, auth);

    // 공개 여부
    const allValid = validation.status === 'VALID' && parsed.items.length === 12;
    const needTr = Settings.get('PUBLISH_REQUIRES_TRANSLATION', 'true') !== 'false';
    const autoPublish = Settings.bool('AUTO_PUBLISH', false) && allValid && (tr.status === 'DONE' || !needTr);
    const pubStatus = autoPublish ? STATUS.PUBLISHED : STATUS.REVIEW;

    // 저장 (여기까지 오류가 없었을 때만)
    const saved = this.save_(today, mode, parsed.items, existing, {
      head: head, validation: validation, translation: tr, pubStatus: pubStatus, sourceName: this.sourceName_(mode),
    });
    HoroscopeRepo.invalidate(today);
    if (validation.status !== 'INVALID') Source.patch({ last_success_at: stamp_() });

    const records = { found: parsed.items.length, valid: validation.status === 'INVALID' ? 0 : parsed.items.length };
    const note = validation.errors.concat(validation.warnings).slice(0, 4).join(' / ');
    if (autoPublish) return { status: 'SUCCESS', records: records, message: '12별자리를 검증해 공개했어요.' + (saved.skipped ? ' (보호된 ' + saved.skipped + '건은 유지)' : '') };
    return { status: 'REVIEW', records: records, message: '저장했어요. 관리자 검수 후 공개됩니다.' + (tr.note ? ' [번역: ' + tr.note + ']' : '') + (note ? ' ' + note : '') };
  },

  classify_: function (p, authorId, today) {
    if (p.is_retweet) return 'RETWEET';
    if (p.author_id !== authorId) return 'FOREIGN_AUTHOR';
    if (kstDateOf_(p.created_at) !== today) return 'OTHER_DATE';
    if (countDistinctSigns_(p.text) >= 3 || parseHoroscopeText_(p.text, today).items.length > 0) return 'HOROSCOPE';
    if (p.media && p.media.length && /星座|占い|ラッキー|おは朝|オハ朝|ohaasa/i.test(p.text)) return 'IMAGE';
    return 'OTHER';
  },

  recordPosts_: function (candidates, today, mode) {
    const known = {};
    Db.readAll(CONFIG.SHEET.POSTS).forEach(function (r) { known[r.post_id + '|' + r.data_mode] = true; });
    candidates.forEach(function (c) {
      if (known[c.post.id + '|' + mode]) return;
      Db.append(CONFIG.SHEET.POSTS, {
        post_id: c.post.id, post_url: c.post.url, published_at: stamp_(new Date(c.post.created_at)),
        horoscope_date: today, classification: c.kind, media_count: (c.post.media || []).length, data_mode: mode, checked_at: stamp_(),
      });
    });
  },

  save_: function (date, mode, items, existing, ctx) {
    const now = stamp_();
    const bySign = {};
    existing.forEach(function (r) { bySign[r.zodiac_sign] = r; });
    const done = {};
    let skipped = 0;

    items.forEach(function (it) {
      if (done[it.sign]) return;                 // 같은 별자리가 두 번 나오면 첫 번째만 (검증에서 이미 오류 처리됨)
      done[it.sign] = true;
      const row = {
        horoscope_date: date, zodiac_sign: it.sign, rank: it.rank === null || it.rank === undefined ? '' : it.rank,
        content_ja: it.content_ja || '', content_ko: it.content_ko || '',
        lucky_item: it.lucky_item || '', lucky_item_ja: it.lucky_item_ja || '',
        lucky_color: it.lucky_color || '', lucky_color_ja: it.lucky_color_ja || '',
        source_name: ctx.sourceName,
        source_post_id: ctx.head.id, source_post_url: ctx.head.url, source_published_at: stamp_(new Date(ctx.head.created_at)),
        translation_status: ctx.translation.status, validation_status: ctx.validation.status,
        validation_note: ctx.validation.errors.concat(ctx.validation.warnings).join(' / ').slice(0, 500),
        publication_status: ctx.pubStatus, data_mode: mode, edited_by_admin: '', updated_at: now,
      };
      const ex = bySign[it.sign];
      if (ex) {
        // AI 주말 운세는 공식 자료가 오면 공식 자료로 바꾼다. 그 밖의 공개·수정된 행은 보호한다
        const isAi = ex.source_name === CONFIG.AI_WEEKEND_SOURCE;
        if (!isAi && (ex.publication_status === STATUS.PUBLISHED || String(ex.edited_by_admin) === 'true')) { skipped++; return; }
        Db.update(CONFIG.SHEET.HOROSCOPES, ex._row, row);
      } else {
        row.id = Utilities.getUuid(); row.created_at = now;
        Db.append(CONFIG.SHEET.HOROSCOPES, row);
      }
    });
    return { skipped: skipped };
  },

  /** 보관 기간이 지난 운세 기록과 출처 기록을 지운다 (RETENTION_DAYS=0이면 지우지 않음) */
  purgeOld_: function () {
    const days = Settings.retentionDays();
    if (!days) return 0;
    const cutoff = addDays_(nowParts_().date, -days);
    let removed = 0;
    [CONFIG.SHEET.HOROSCOPES, CONFIG.SHEET.POSTS].forEach(function (name) {
      const rows = Db.readAll(name).filter(function (r) { return r.horoscope_date && r.horoscope_date < cutoff; });
      if (rows.length) { Db.deleteRows(name, rows.map(function (r) { return r._row; })); removed += rows.length; }
    });
    return removed;
  },
};

/* ---------------------------------------------------------------- 스케줄러 */

/**
 * 5분마다 실행되는 "시계". 한국 시간 8:00 / 8:10 / 8:30 / 9:00 슬롯이 지났고 아직 처리하지 않았다면 확인 작업을 한 번 실행한다.
 * (Apps Script의 시간 트리거는 정확한 '분'을 보장하지 못해서, 5분마다 깨어나 슬롯을 판단하는 방식을 쓴다.
 *  슬롯 처리 기록은 하루 단위라 여러 번 깨어나도 중복 실행되지 않는다.)
 */
function tick() {
  if (!Source.enabled()) return;
  const now = nowParts_();
  const props = PropertiesService.getScriptProperties();
  const key = function (s) { return 'SLOT_' + now.date + '_' + s; };

  const due = CONFIG.SLOTS.filter(function (s) { return timeToMinutes_(s) <= now.minutes && !props.getProperty(key(s)); });
  if (!due.length) return;
  due.forEach(function (s) { props.setProperty(key(s), '1'); });

  // 어제 이전의 슬롯 기록 정리
  props.getKeys().forEach(function (k) { if (/^SLOT_\d{4}-\d{2}-\d{2}_/.test(k) && k.indexOf('SLOT_' + now.date) !== 0) props.deleteProperty(k); });

  Importer.run('AUTO ' + due[due.length - 1], {});
  // 토·일요일: 공식 운세가 없으면 AI 주말 운세를 미리 만들어 둔다
  if (Settings.mode() === 'PRODUCTION' && WeekendAi.isWeekend(now.date)) { try { WeekendAi.ensure(now.date, 'AUTO'); } catch (e) { /* 무시 */ } }

  if (due.indexOf(CONFIG.FINAL_SLOT) >= 0) { try { Importer.purgeOld_(); } catch (e) { /* 무시 */ } }
}

/** 편집기에서 한 번 실행(소유자 전용): 5분마다 tick을 돌리는 트리거를 만든다 */
function installTriggers() { requireOwner_(); installTriggers_(); }
function removeTriggers() { requireOwner_(); removeTriggers_(); }

function installTriggers_() {
  removeTriggers_();
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
  Logger.log('자동 확인 트리거를 만들었어요. (5분마다 시각을 확인해 08:00 / 08:10 / 08:30 / 09:00에 실행)');
}
function removeTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); });
}
function triggersInstalled_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'tick'; });
}
