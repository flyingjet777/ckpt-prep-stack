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
app.get('/gate', async (req, res) => {
    const { flightNumber, date } = req.query;
    if (!flightNumber || !date) return res.status(400).json({ error: 'flightNumber, date required' });
    if (!AERODATABOX_KEY) return res.status(500).json({ error: 'server missing AERODATABOX_KEY' });
    try {
        const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}/${encodeURIComponent(date)}`;
        const r = await fetch(url, {
            headers: {
                'x-rapidapi-key': AERODATABOX_KEY,
                'x-rapidapi-host': 'aerodatabox.p.rapidapi.com'
            }
        });
        if (!r.ok) throw new Error(`upstream ${r.status}`);
        const data = await r.json();
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

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 8765;
app.listen(PORT, '0.0.0.0', () => console.log(`ckpt-proxy listening on 0.0.0.0:${PORT}`));
