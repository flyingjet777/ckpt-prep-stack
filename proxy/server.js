// ckpt-prep-stack 공용 프록시 — 모든 파일럿이 키 입력 없이 METAR/게이트/NOTAM AI 요약을 쓰도록
// 비밀 키(ANTHROPIC_API_KEY, AERODATABOX_KEY)는 서버 환경변수에만 존재, 클라이언트에는 절대 노출 안 됨.
const express = require('express');
const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const AERODATABOX_KEY = process.env.AERODATABOX_KEY || '';

// METAR — aviationweather.gov는 브라우저 CORS를 막아놓아서 서버에서 대신 호출
app.get('/metar', async (req, res) => {
    const ids = req.query.ids;
    if (!ids) return res.status(400).json({ error: 'ids required' });
    try {
        const url = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(ids)}&format=json&hours=2`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`upstream ${r.status}`);
        const data = await r.json();
        res.json(data);
    } catch (err) {
        res.status(502).json({ error: String(err) });
    }
});

// 게이트 — AeroDataBox (RapidAPI 키는 서버에만 보관)
// 무료 쿼터가 월 300유닛뿐이라 성공 응답을 30분 캐시해 중복 호출을 흡수한다.
const GATE_CACHE_MS = 30 * 60 * 1000;
const gateCache = new Map(); // key: "FLT|YYYY-MM-DD" → { time, data }

app.get('/gate', async (req, res) => {
    const { flightNumber, date } = req.query;
    if (!flightNumber || !date) return res.status(400).json({ error: 'flightNumber, date required' });
    if (!AERODATABOX_KEY) return res.status(500).json({ error: 'server missing AERODATABOX_KEY' });

    const cacheKey = `${flightNumber.toUpperCase()}|${date}`;
    const cached = gateCache.get(cacheKey);
    if (cached && (Date.now() - cached.time) < GATE_CACHE_MS) {
        console.log(`[gate] cache hit: ${cacheKey}`);
        return res.json(cached.data);
    }

    try {
        const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}/${encodeURIComponent(date)}`;
        const r = await fetch(url, {
            headers: {
                'x-rapidapi-key': AERODATABOX_KEY,
                'x-rapidapi-host': 'aerodatabox.p.rapidapi.com'
            }
        });
        if (!r.ok) {
            // 429(쿼터 소진)는 클라이언트가 구분할 수 있게 상태코드를 그대로 전달
            const status = r.status === 429 ? 429 : 502;
            console.warn(`[gate] upstream ${r.status}: ${cacheKey}`);
            return res.status(status).json({ error: `upstream ${r.status}` });
        }
        const data = await r.json();
        gateCache.set(cacheKey, { time: Date.now(), data });
        // 캐시가 무한히 자라지 않게 오래된 항목 정리
        if (gateCache.size > 200) {
            const now = Date.now();
            for (const [k, v] of gateCache) {
                if (now - v.time >= GATE_CACHE_MS) gateCache.delete(k);
            }
        }
        res.json(data);
    } catch (err) {
        res.status(502).json({ error: String(err) });
    }
});

// NOTAM AI 요약 — Anthropic API (키는 서버에만 보관)
app.post('/notam-summary', async (req, res) => {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'server missing ANTHROPIC_API_KEY' });
    try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 1500,
                messages: [{ role: 'user', content: prompt }]
            })
        });
        if (!r.ok) throw new Error(`upstream ${r.status}: ${await r.text()}`);
        const data = await r.json();
        res.json(data);
    } catch (err) {
        res.status(502).json({ error: String(err) });
    }
});

// ATIS — 미국은 공식 atis.info(구 datis.clowd.io, FAA SWIM), 그 외는 atis.guru(ACARS 수집, 비공식)로 폴백
function decodeAtisText(s) {
    return s
        .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

async function fetchFaaAtis(icao) {
    const r = await fetch(`https://atis.info/api/${encodeURIComponent(icao)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data.map(d => ({
        type: (d.type || 'combined').toUpperCase(),
        code: d.code || '',
        text: d.datis || '',
        time: d.time || '',
        updatedAt: d.updatedAt || ''
    }));
}

async function fetchGuruAtis(icao) {
    const r = await fetch(`https://atis.guru/atis/${encodeURIComponent(icao)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!r.ok) return null;
    const html = await r.text();
    // atis.guru는 Blazor SSR이라 본문 HTML에 "<h5 class=card-title>구분</h5> ... <div class=atis>본문</div>" 카드가 그대로 박혀 나옴
    const cardRe = /<h5 class="card-title"[^>]*>\s*([^<]+?)\s*<\/h5>(?:\s*<h6[^>]*>([^<]*)<\/h6>)?[\s\S]*?<div class="atis">([\s\S]*?)<\/div>/g;
    const results = [];
    let m;
    while ((m = cardRe.exec(html)) !== null) {
        const title = m[1].trim();
        if (!/ATIS/i.test(title)) continue; // METAR/TAF 카드는 건너뜀 — 공식 METAR는 /metar에서 별도 제공
        results.push({
            type: /arrival/i.test(title) ? 'ARR' : /departure/i.test(title) ? 'DEP' : 'COMBINED',
            code: '',
            text: decodeAtisText(m[3]),
            time: (m[2] || '').trim(),
            updatedAt: ''
        });
    }
    return results.length ? results : null;
}

app.get('/atis', async (req, res) => {
    const icao = (req.query.icao || '').trim().toUpperCase();
    if (!icao) return res.status(400).json({ error: 'icao required' });
    try {
        const faa = await fetchFaaAtis(icao);
        if (faa) return res.json({ icao, source: 'faa', atis: faa });

        const guru = await fetchGuruAtis(icao);
        if (guru) {
            return res.json({
                icao, source: 'guru', atis: guru,
                disclaimer: '비공식 데이터(ACARS 수집, atis.guru) — 운항 참고용으로만 사용. 최신 요청이 없으면 갱신 안 됨.'
            });
        }

        return res.json({ icao, source: null, atis: [] });
    } catch (err) {
        res.status(502).json({ error: String(err) });
    }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 8765;
app.listen(PORT, '0.0.0.0', () => console.log(`ckpt-proxy listening on 0.0.0.0:${PORT}`));
