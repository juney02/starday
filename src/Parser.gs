/**
 * 게시물 텍스트 분석 + 검증
 *
 * ★ 주의: 실제 @Hi_Ohaasa 게시물의 문장 형식은 아직 확인하지 못했다.
 *   이 분석기는 "N位 + 별자리 이름" 줄을 기준으로 읽는 일반적인 형식에 맞춰져 있다.
 *   실제 게시물을 확인한 뒤, 맞지 않으면 parseHoroscopeText_ 만 고치면 된다. (잘못 읽으면 검증에서 걸러져 공개되지 않는다)
 *
 * 인식하는 모양
 *   1位 おひつじ座        ← 순위와 별자리가 한 줄 (순서가 바뀌어도 됨)
 *   (설명 문장 여러 줄)
 *   ラッキーアイテム：青いノート
 *   ラッキーカラー：青
 */
function parseHoroscopeText_(text, refDate) {
  const result = { date: null, items: [], warnings: [] };
  const lines = String(text).split(/\r?\n/);
  const rankRe = /(?:第)?\s*(\d{1,2})\s*位/;
  const itemRe = /らっきー[・･]?あいてむ\s*[:]?\s*/;
  const colorRe = /らっきー[・･]?からー\s*[:]?\s*/;

  // 날짜
  const flat = matchForm_(text);
  let m = /(\d{4})\s*[\/年.\-]\s*(\d{1,2})\s*[\/月.\-]\s*(\d{1,2})/.exec(flat);
  if (m) result.date = m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  else if ((m = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(flat)) && refDate) {
    let year = Number(refDate.slice(0, 4));
    let cand = year + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    if (cand > addDays_(refDate, 1)) cand = (year - 1) + cand.slice(4);   // 12월 게시물이 1월에 해석되는 경우 등
    result.date = cand;
  }

  let cur = null, pendingRank = null;
  const flush = function () { if (cur) { cur.content_ja = cur.content.join('\n').trim(); delete cur.content; result.items.push(cur); cur = null; } };

  lines.forEach(function (raw) {
    const line = raw.trim();
    if (!line) return;
    const mf = matchForm_(line);

    const sign = findSignInText_(line);
    const rm = rankRe.exec(mf);

    // 순위만 있는 줄: 다음 줄의 별자리에 붙인다
    if (rm && !sign && /^[【\[(（]?\s*(?:第)?\s*\d{1,2}\s*位\s*[】\])）]?$/.test(mf.trim())) { pendingRank = Number(rm[1]); return; }

    // 머리줄: 별자리 + 순위
    if (sign && (rm || pendingRank !== null)) {
      flush();
      cur = { sign: sign.key, rank: rm ? Number(rm[1]) : pendingRank, content: [], lucky_item_ja: '', lucky_color_ja: '' };
      pendingRank = null;
      return;
    }
    if (!cur) return;                                        // 첫 항목 전의 제목/소개 줄은 무시

    let k;
    if ((k = itemRe.exec(mf))) { cur.lucky_item_ja = line.slice(k.index + k[0].length).trim(); return; }
    if ((k = colorRe.exec(mf))) { cur.lucky_color_ja = line.slice(k.index + k[0].length).trim(); return; }
    if (/^#/.test(line) || /https?:\/\//.test(line)) return;  // 해시태그·링크 줄은 설명에 넣지 않는다
    cur.content.push(line);
  });
  flush();

  result.items.forEach(function (it) { if (!it.content_ja) result.warnings.push(it.sign + ': 운세 설명을 찾지 못했어요.'); });
  return result;
}

/**
 * 검증 (사양: 12별자리 / 1~12위 / 순위·별자리 중복 없음 / 작성자 확인 / 날짜 일치 / 누락 데이터 생성 금지)
 * @return {{status:'VALID'|'NEEDS_REVIEW'|'INVALID', errors:string[], warnings:string[]}}
 *   INVALID: 공개 불가 / NEEDS_REVIEW: 구조는 맞지만 사람이 확인해야 함 / VALID: 자동 공개 가능
 */
function validateHoroscope_(items, ctx) {
  const errors = [], warnings = (ctx.warnings || []).slice();

  if (items.length !== 12) errors.push('별자리가 12개여야 하는데 ' + items.length + '개예요.');
  const signs = {}, ranks = {};
  items.forEach(function (it) {
    if (ZODIAC_KEYS.indexOf(it.sign) < 0) errors.push('알 수 없는 별자리: ' + it.sign);
    if (signs[it.sign]) errors.push('별자리 중복: ' + it.sign);
    signs[it.sign] = true;
    const r = Number(it.rank);
    if (!(r >= 1 && r <= 12) || Math.floor(r) !== r) errors.push(it.sign + ' 순위가 올바르지 않아요: ' + it.rank);
    else if (ranks[r]) errors.push('순위 중복: ' + r + '위');
    ranks[r] = true;
  });
  const missingSigns = ZODIAC_KEYS.filter(function (k) { return !signs[k]; });
  if (missingSigns.length) errors.push('누락된 별자리: ' + missingSigns.join(', '));
  const missingRanks = []; for (let r = 1; r <= 12; r++) if (!ranks[r]) missingRanks.push(r);
  if (missingRanks.length) errors.push('누락된 순위: ' + missingRanks.join(', ') + '위');

  if (ctx.authorOk === false) errors.push('대상 계정(@' + CONFIG.DEFAULT_USERNAME + ')이 쓴 게시물이 아니에요.');
  if (!ctx.parsedDate) errors.push('운세 기준 날짜를 게시물에서 찾지 못했어요.');
  else if (ctx.parsedDate !== ctx.expectedDate) errors.push('운세 날짜(' + ctx.parsedDate + ')가 오늘(' + ctx.expectedDate + ')과 달라요.');

  items.forEach(function (it) {
    if (!it.content_ja) warnings.push(it.sign + ': 운세 설명이 비어 있어요.');
  });
  if (ctx.fromImage) warnings.push('이미지 분석 결과라서 사람이 확인해야 해요.');

  const status = errors.length ? 'INVALID' : (warnings.length ? 'NEEDS_REVIEW' : 'VALID');
  return { status: status, errors: errors, warnings: warnings };
}
