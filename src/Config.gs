/**
 * 설정 / 공통 도우미
 *
 * 비밀 값(API 키 등)은 코드에 쓰지 않고 "스크립트 속성"에 보관한다.
 * (편집기 왼쪽 ⚙ 프로젝트 설정 → 스크립트 속성). 목록은 SCRIPT_PROPERTIES.example.txt 참고.
 */
const CONFIG = {
  TIMEZONE: 'Asia/Seoul',
  SHEET: { HOROSCOPES: 'daily_horoscopes', LOGS: 'import_logs', SOURCES: 'source_settings', POSTS: 'source_posts' },
  SOURCE_ID: 'X_OHAASA',
  SOURCE_NAME: 'X @Hi_Ohaasa',
  SITE_SOURCE_NAME: '朝日放送テレビ「おはよう朝日です」公式サイト',
  DEFAULT_USERNAME: 'Hi_Ohaasa',
  OFFICIAL_ACCOUNT_URL: 'https://x.com/Hi_Ohaasa',
  // 자동 확인 시각 (한국 시간). 이전 슬롯에서 데이터를 찾았다면 이후 슬롯은 건너뛴다.
  SLOTS: ['08:00', '08:10', '08:30', '09:00'],
  FINAL_SLOT: '09:00',
  TEST_SOURCE_NAME: '[TEST] 가상 X 게시물',
  MSG_PENDING_FINAL: '오늘의 오하아사 운세가 아직 업데이트되지 않았어요. 공식 게시물을 확인한 뒤 반영됩니다.',
  MSG_PENDING_EARLY: '오늘의 운세를 확인하고 있어요. 보통 오전 8시~9시 사이에 반영돼요.',
  // 앱을 열었는데 오늘 운세가 없으면 그 자리에서 공식 사이트를 확인한다 (이 시각 이후, 10분에 한 번까지)
  ON_DEMAND_FROM: '05:00',
  ON_DEMAND_GAP_SEC: 600,
  // 공식 사이트에 아직 어제 운세가 남아 있을 때, 며칠 전 것까지 "그 날짜의 기록"으로 저장할지
  BACKFILL_DAYS: 3,
  // 토·일요일(오하아사 방송 없음)에 별하루가 직접 만드는 운세의 출처 이름 (WeekendAi.gs)
  AI_WEEKEND_SOURCE: '별하루 AI 주말 운세 (오하아사 아님)',
  MSG_WEEKEND: '오하아사는 토·일요일에 방송이 없어요. 월요일 아침에 새 운세가 올라와요.',
};

// 12별자리의 고유 영문 식별자
const ZODIAC_KEYS = [
  'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
  'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces',
];

// 데이터 상태
const STATUS = {
  MOCK: 'MOCK', PENDING: 'PENDING', RECEIVED: 'RECEIVED',
  REVIEW: 'REVIEW', PUBLISHED: 'PUBLISHED', FAILED: 'FAILED', HIDDEN: 'HIDDEN',
};

/**
 * 런타임 설정 (스크립트 속성)
 *  MODE                 'TEST'(기본) | 'PRODUCTION'
 *  AUTO_PUBLISH         'true'면 검증을 통과한 데이터를 관리자 승인 없이 바로 공개 (기본 false)
 *  PUBLISH_REQUIRES_TRANSLATION  'false'가 아니면 한국어 번역이 끝나야 공개 (기본 true)
 *  TEST_FALLBACK        TEST 모드에서 저장된 테스트 데이터가 없을 때 즉석 가상 운세를 보여줄지 (기본 true)
 *  TEST_SCENARIO        TEST 모드 가상 게시물 시나리오 (normal, none, duplicate_rank, missing_sign, wrong_date, image_only)
 *  RETENTION_DAYS       운세 보관·표시 기간(일). 0이면 제한 없음 (기본 30)
 *  PROD_SOURCE          운영 모드 수집 경로: 'SITE'(공식 사이트 horoscope.json, 기본) | 'X'(X 공식 API)
 *  WEEKEND_AI           'false'가 아니면, 토·일요일에 AI가 만든 재미용 운세를 보여줌 (Gemini 키 필요, 기본 true)
 *  ON_DEMAND_FETCH      'false'가 아니면, 운영 모드에서 앱을 열었을 때 오늘 운세가 없으면 바로 공식 사이트를 확인 (기본 true)
 *  ※ 처음 설정은 편집기에서 setupRealApp() 하나만 실행하면 된다 (실제 운세 모드로 맞춤)
 *  OCR_ENABLED          'true'일 때만 이미지 분석 사용 (기본 false)
 *  TRANSLATE_MODEL      번역/이미지 분석에 쓸 Claude 모델 (기본 claude-sonnet-5-5)
 *  비밀: X_BEARER_TOKEN, ANTHROPIC_API_KEY, ADMIN_TOKEN, ADMIN_EMAILS
 */
const Settings = {
  get: function (key, def) {
    const v = PropertiesService.getScriptProperties().getProperty(key);
    return (v === null || v === undefined || v === '') ? def : v;
  },
  set: function (key, val) { PropertiesService.getScriptProperties().setProperty(key, String(val)); },
  bool: function (key, def) { return this.get(key, def ? 'true' : 'false') === 'true'; },
  has: function (key) { return !!this.get(key, ''); },
  mode: function () { return this.get('MODE', 'TEST') === 'PRODUCTION' ? 'PRODUCTION' : 'TEST'; },
  retentionDays: function () { const n = parseInt(this.get('RETENTION_DAYS', '30'), 10); return isNaN(n) || n < 0 ? 30 : n; },
};

/* ---------- 시간 도우미 (모두 한국 시간 기준) ---------- */
function nowParts_(d) {
  d = d || new Date();
  const date = Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const time = Utilities.formatDate(d, CONFIG.TIMEZONE, 'HH:mm');
  return { date: date, time: time, minutes: timeToMinutes_(time) };
}
function timeToMinutes_(hhmm) { const p = String(hhmm).split(':'); return Number(p[0]) * 60 + Number(p[1]); }
function stamp_(d) { return Utilities.formatDate(d || new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'); }
function kstDateOf_(iso) { return Utilities.formatDate(new Date(iso), CONFIG.TIMEZONE, 'yyyy-MM-dd'); }
function addDays_(dateStr, n) {
  const p = dateStr.split('-');
  const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}
