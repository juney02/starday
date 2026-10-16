/**
 * 이미지 게시물 분석 모듈 (기본 꺼짐)
 *
 * 켜는 조건(모두 필요): 스크립트 속성 OCR_ENABLED=true, ANTHROPIC_API_KEY, 출처 이용 허락 APPROVED,
 *                     그리고 공식 API로 접근한 이미지 URL.
 * 결과는 절대 자동 공개하지 않는다. 모든 항목을 "관리자 검토 필요"로 저장한다.
 * 읽을 수 없는 칸은 비워 두고(추측 금지) 경고로 남긴다.
 */
const ImageOcr = {
  enabled: function () { return Settings.bool('OCR_ENABLED', false) && Settings.has('ANTHROPIC_API_KEY'); },

  /** @return {{date:string|null, items:Array, warnings:string[]}} */
  extract: function (imageUrls) {
    const out = { date: null, items: [], warnings: [] };
    const seen = {};
    imageUrls.forEach(function (url) {
      let parsed;
      try {
        parsed = anthropicJson_({
          model: Settings.get('TRANSLATE_MODEL', 'claude-sonnet-5-5'), max_tokens: 4000,
          system: '日本語の12星座占いの画像を読み取り、JSONだけで返してください。読み取れない・不明確な項目はnullにしてください。推測や補完は絶対にしないでください。',
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'url', url: url } },
            { type: 'text', text: '次の形式で返してください: {"date":"YYYY-MM-DD" or null,"items":[{"sign_ja":"おひつじ座","rank":1,"content_ja":"","lucky_item_ja":"","lucky_color_ja":""}]}' },
          ] }],
        });
      } catch (e) { out.warnings.push('이미지 분석 실패: ' + e.message); return; }

      if (parsed.date && !out.date) out.date = String(parsed.date);
      (parsed.items || []).forEach(function (p) {
        const key = zodiacKeyFromName_(p.sign_ja || '');
        const rank = Number(p.rank);
        if (!key) { out.warnings.push('별자리를 인식하지 못했어요: ' + p.sign_ja); return; }
        if (seen[key]) return;
        seen[key] = true;
        if (!(rank >= 1 && rank <= 12)) out.warnings.push(key + ': 순위를 읽지 못했어요.');
        out.items.push({
          sign: key, rank: (rank >= 1 && rank <= 12) ? rank : null,
          content_ja: p.content_ja || '', lucky_item_ja: p.lucky_item_ja || '', lucky_color_ja: p.lucky_color_ja || '',
        });
      });
    });
    return out;
  },
};
