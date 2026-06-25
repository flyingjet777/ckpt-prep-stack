// Active flight planning extracted data
const flightData = {
    // ACTIVE/INIT Page Values
    fltNbr: '',
    from: '',
    to: '',
    altn: '',
    cponyRte: '',     
    altnRte: '',      
    crzFl: '',  
    crzTemp: '',
    mode: 'ECON',
    tropo: '36090 FT',
    ci: '',          
    tripWind: '',   
    apms: '',  
    
    // FUEL & LOAD Page Values in "klbs" units
    gw: '',   
    cg: '',
    fob: '',   
    zfw: '',   
    zfwcg: '',
    taxi: '',
    paxNbr: '',
    cargoTons: '',
    trip: '',  
    tripTime: '',
    rteRsv: '', 
    rteRsvPct: '',
    altnFuel: '', 
    altnTime: '',
    final: '',
    finalTime: '',
    tow: '',
    lw: '',
    fod: '',
    ccf: '',
    tank: '',
    fuelStatMean: '',
    fuelStat95: '',
    fuelStat99: '',
    acftReg: '',
    etd: '',
    eta: '',
    flightDay: '',
    depWeatherRaw: [],
    arrWeatherRaw: [],
    altnWeatherRaw: [],
    enrteWeatherRaw: [],
    turbZones: null,
    depNotamEntries: [],
    arrNotamEntries: [],
    altnNotamEntries: [],
    etpNotamSections: [],   // Array of { title, entries } from NOTAM PACKAGE 2 [ETP] sections
    firNotamSections: [],   // Array of { fir, rawText } from NOTAM PACKAGE 3 [FIR] sections
    firAiSummary: '',       // Claude AI 요약 결과 (한국어)
    firAiStatus: 'idle',    // 'idle' | 'loading' | 'done' | 'error'
    depRunwayInfo: '',
    arrRunwayInfo: '',
    altnRunwayInfo: '',
    depGate: '',           // 출발 게이트 (AeroDataBox)
    depTerminal: '',       // 출발 터미널
    gateStatus: 'idle',   // 'idle' | 'loading' | 'done' | 'error'
    depMetar: null,        // { raw, flight_category, observed } — aviationweather.gov
    arrMetar: null,
    metarCacheTime: 0      // Date.now() at last fetch — 15분 캐싱
};

// Keep track of raw values parsed from PDF
let lastImportedPdfData = null;

function resetFlightData() {
    for (let key in flightData) {
        if (key === 'mode') flightData[key] = 'ECON';
        else if (key === 'tropo') flightData[key] = '36090 FT';
        else if (key === 'turbZones') flightData[key] = null;
        else if (Array.isArray(flightData[key])) flightData[key] = [];
        else flightData[key] = '';
    }
    melCdlData = [];
    routeData = [];
    altnRouteData = [];
    lolvEtpData = [];
    eraValidationData = [];
    refileFltPlanData = null;
    atsFplCompareResult = null;
    altnRteScrollIndex = 0;
    stepAltData.length = 0;
    // Add default blank rows so the screen has visual placeholders when empty
    stepAltData.push({ wpt: '--------', alt: '---', dist: '', time: '' });
    stepAltData.push({ wpt: '--------', alt: '---', dist: '', time: '' });
    stepAltScrollIndex = 0;
}

// --- Computed Values ---
// destUtc is updated from the OFP "ETA ... Z" line on import.
let destUtc = '';

const addTimeStr = (t1, t2) => {
    if (!t1 || !t2) return t1 || t2 || '';
    const [h1, m1] = t1.split(':').map(Number);
    const [h2, m2] = t2.split(':').map(Number);
    if (isNaN(h1) || isNaN(m1) || isNaN(h2) || isNaN(m2)) return '';
    let totalMins = m1 + m2;
    let extraHour = Math.floor(totalMins / 60);
    let finalMins = totalMins % 60;
    let finalHours = (h1 + h2 + extraHour) % 24;
    return String(finalHours).padStart(2, '0') + ':' + String(finalMins).padStart(2, '0');
};

const getAltnUtc = () => addTimeStr(destUtc, flightData.altnTime);
const getDestMinFuel = () => {
    const f = num(flightData.final);
    return f > 0 ? (f * 1.3).toFixed(1) : '';
};
// EFOB / EXTRA are derived from current flightData so they stay
// consistent after a PDF import or a manual edit.
// EFOB DEST = (FOB - TAXI) - TRIP ; EFOB ALTN = EFOB DEST - ALTN ; EXTRA = EFOB DEST - FINAL
const num = (v) => parseFloat(String(v).replace(/[^\d.\-]/g, '')) || 0;
const getDestEfob = () => {
    if (flightData.fod !== undefined && flightData.fod !== null && flightData.fod !== '') {
        return num(flightData.fod).toFixed(1);
    }
    return (num(flightData.fob) - num(flightData.taxi) - num(flightData.trip)).toFixed(1);
};
const getAltnEfob = () => (parseFloat(getDestEfob()) - num(flightData.altnFuel)).toFixed(1);
const getExtraFuel = () => (parseFloat(getDestEfob()) - num(flightData.final)).toFixed(1);
const extraTime = '01:28';

// Timezone offset, local time, and weather extractors
function getPageTextWithNewlines(textContent) {
    const items = textContent.items;
    if (items.length === 0) return '';
    
    const validItems = items.filter(item => item.transform && item.transform.length >= 6);
    
    validItems.sort((a, b) => {
        const yDiff = b.transform[5] - a.transform[5];
        if (Math.abs(yDiff) > 3) {
            return yDiff;
        }
        return a.transform[4] - b.transform[4];
    });
    
    let text = '';
    let lastY = null;
    
    validItems.forEach(item => {
        const y = item.transform[5];
        const str = item.str;
        
        if (lastY === null) {
            text += str;
        } else if (Math.abs(y - lastY) > 3) {
            text += '\n' + str;
        } else {
            text += ' ' + str;
        }
        lastY = y;
    });
    
    // Split by lines, filter out lines that match page numbers, then join back
    const lines = text.split('\n');
    const filteredLines = lines.filter(line => !line.trim().match(/^Page\s+\d+$/i));
    return filteredLines.join('\n');
}

function getAirportOffset(icao) {
    if (!icao) return 0;
    const code = icao.toUpperCase();
    if (code === 'RKSI' || code === 'RKSS') return 9;
    if (code === 'KLAX') return -7;
    if (code === 'KJFK') return -4;
    return 0; // Default to UTC
}

function getLocalTimeStr(utcTimeStr, offset) {
    if (!utcTimeStr) return '';
    const [h, m] = utcTimeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return '';
    let localHours = (h + offset) % 24;
    if (localHours < 0) localHours += 24;
    return String(localHours).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ' L';
}

function getArrivalDay(depDay, depTime, arrTime) {
    if (!depDay || !depTime || !arrTime) return depDay;
    const [depH, depM] = depTime.split(':').map(Number);
    const [arrH, arrM] = arrTime.split(':').map(Number);
    let arrDay = parseInt(depDay, 10);
    if (arrH < depH || (arrH === depH && arrM < depM)) {
        arrDay += 1;
    }
    return String(arrDay).padStart(2, '0');
}

function parseTafLines(lines, targetDay, targetTime) {
    if (!targetDay || !targetTime) {
        return lines.map(line => ({ text: line, highlight: false }));
    }
    
    const [tHour, tMin] = targetTime.split(':').map(Number);
    const targetVal = parseInt(targetDay, 10) * 2400 + tHour * 100 + tMin;
    
    // Group lines into airport blocks
    const blocks = [];
    let currentBlock = null;
    
    lines.forEach((lineText) => {
        const line = lineText.trim();
        if (line.startsWith('TAF') || line.match(/^[A-Z]{4}\s+\d{6}Z\s+\d{4}\/\d{4}\b/i)) {
            if (currentBlock) {
                blocks.push(currentBlock);
            }
            currentBlock = { lines: [] };
        }
        if (!currentBlock) {
            currentBlock = { lines: [] };
        }
        currentBlock.lines.push(lineText);
    });
    if (currentBlock) {
        blocks.push(currentBlock);
    }
    
    const processedLines = [];
    
    blocks.forEach((block, blockIdx) => {
        const blockLines = block.lines;
        let candidates = [];
        
        blockLines.forEach((line, idx) => {
            let val = null;
            
            // Match FMddhhmm
            const fmMatch = line.match(/\bFM(\d{2})(\d{2})(\d{2})\b/i);
            if (fmMatch) {
                val = parseInt(fmMatch[1], 10) * 2400 + parseInt(fmMatch[2], 10) * 100 + parseInt(fmMatch[3], 10);
            } else {
                // Match BECMG ddhh/ddhh or TEMPO ddhh/ddhh
                const periodMatch = line.match(/\b(?:BECMG|TEMPO)\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/i);
                if (periodMatch) {
                    val = parseInt(periodMatch[1], 10) * 2400 + parseInt(periodMatch[2], 10) * 100;
                } else {
                    // Match main TAF validity, e.g. ddhh/ddhh
                    const tafMatch = line.match(/\b(?:TAF\s+)?(?:[A-Z]{4}\s+\d{6}Z\s+)?(\d{2})(\d{2})\/(\d{2})(\d{2})\b/i);
                    if (tafMatch) {
                        val = parseInt(tafMatch[1], 10) * 2400 + parseInt(tafMatch[2], 10) * 100;
                    }
                }
            }
            
            if (val !== null && val <= targetVal) {
                candidates.push({ idx, val });
            }
        });
        
        let highlightIdx = -1;
        if (candidates.length > 0) {
            candidates.sort((a, b) => b.val - a.val);
            highlightIdx = candidates[0].idx;
        }
        
        // Add blank line separation between airport blocks
        if (blockIdx > 0) {
            processedLines.push({ isBlank: true, text: '', highlight: false });
        }
        
        blockLines.forEach((line, idx) => {
            processedLines.push({
                text: line,
                highlight: idx === highlightIdx
            });
        });
    });
    
    return processedLines;
}

function getAirportLongitude(icao) {
    if (!icao) return 0;
    const coords = {
        'CYEG': -113.5, 'CYVR': -123.18, 'CYWG': -97.24, 'CYXE': -106.7,
        'CYXY': -135.07, 'CYYC': -114.02, 'CYYQ': -94.06, 'CYYZ': -79.63,
        'CYZF': -114.44, 'KBOS': -71.01, 'KDLH': -92.18, 'KDTW': -83.35,
        'KJFK': -73.78, 'KLAX': -118.41, 'KMSP': -93.22, 'KONT': -117.6,
        'KORD': -87.9, 'KRFD': -89.1, 'KSEA': -122.3, 'KSFO': -122.37,
        'PACD': -162.72, 'PAFA': -147.86, 'PAKN': -156.65, 'PAKT': -131.71,
        'PANC': -149.99, 'PASY': 174.11, 'PHNL': -157.92, 'PKWA': 167.73,
        'PMDY': -177.38, 'PWAK': 166.64, 'RJAA': 140.39, 'RJBB': 135.23,
        'RJCC': 141.69, 'RJGG': 136.81, 'RJTT': 139.78, 'RKPC': 126.49,
        'RKSI': 126.44, 'RKSS': 126.79, 'ROAH': 127.64, 'RORS': 124.78
    };
    return coords[icao.toUpperCase()] !== undefined ? coords[icao.toUpperCase()] : 0;
}

function getAirportEta(icao) {
    const from = flightData.from || 'KLAX';
    const to = flightData.to || 'RKSI';
    const altn = flightData.altn || 'RKSS';
    
    const depDay = parseInt(flightData.flightDay || '08', 10);
    const [etdH, etdM] = (flightData.etd || '17:10').split(':').map(Number);
    const mDep = depDay * 1440 + etdH * 60 + etdM;
    
    let tripDuration = 13 * 60 + 2; // default 13:02
    if (flightData.tripTime) {
        const parts = flightData.tripTime.split(':');
        if (parts.length === 2) {
            const h = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            if (!isNaN(h) && !isNaN(m)) {
                tripDuration = h * 60 + m;
            }
        }
    }
    
    let targetM = mDep;
    const code = icao.toUpperCase();
    
    if (code === from.toUpperCase()) {
        targetM = mDep;
    } else if (code === to.toUpperCase()) {
        targetM = mDep + tripDuration;
    } else if (code === altn.toUpperCase()) {
        let altnDuration = 17; // default 17 mins
        if (flightData.altnTime) {
            const parts = flightData.altnTime.split(':');
            if (parts.length === 2) {
                const h = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                if (!isNaN(h) && !isNaN(m)) {
                    altnDuration = h * 60 + m;
                }
            }
        }
        targetM = mDep + tripDuration + altnDuration;
    } else {
        const lonD = getAirportLongitude(from);
        const lonA = getAirportLongitude(to);
        const lonP = getAirportLongitude(code);
        
        let fraction = 0.5;
        if (lonD !== 0 || lonA !== 0) {
            let diffEast = lonA - lonD;
            if (diffEast < 0) diffEast += 360;
            
            let diffWest = lonD - lonA;
            if (diffWest < 0) diffWest += 360;
            
            const isEastbound = diffEast < diffWest;
            const totalDistance = isEastbound ? diffEast : diffWest;
            
            let distP = 0;
            if (isEastbound) {
                distP = lonP - lonD;
                if (distP < 0) distP += 360;
            } else {
                distP = lonD - lonP;
                if (distP < 0) distP += 360;
            }
            
            fraction = totalDistance > 0 ? distP / totalDistance : 0.5;
            if (fraction < 0) fraction = 0;
            if (fraction > 1) fraction = 1;
        }
        targetM = mDep + fraction * tripDuration;
    }
    
    const day = Math.floor(targetM / 1440);
    const timeMin = Math.floor(targetM % 1440);
    const hour = Math.floor(timeMin / 60);
    const min = timeMin % 60;
    
    return {
        day: String(day).padStart(2, '0'),
        time: String(hour).padStart(2, '0') + ':' + String(min).padStart(2, '0')
    };
}

function parseTafLinesWithWindow(rawLines, windowHours, allowedIcaos = null) {
    const airportBlocks = [];
    let currentBlock = null;
    
    rawLines.forEach((lineText, originalIndex) => {
        const line = lineText.trim();
        // PDF 추출 시 "TAF HNL"의 공백이 사라져 "TAFHNL"처럼 붙는 경우가 있어 \b 없이 매칭
        if (line.match(/^\s*TAF/i)) {
            if (currentBlock) {
                airportBlocks.push(currentBlock);
            }
            const parts = line.split(/\s+/);
            let icao = '';
            for (let i = 1; i < parts.length; i++) {
                if (parts[i].length === 4 && parts[i].match(/^[A-Z]{4}$/i)) {
                    icao = parts[i].toUpperCase();
                    break;
                }
            }
            currentBlock = {
                icao: icao,
                lines: []
            };
        }
        
        if (currentBlock) {
            currentBlock.lines.push({ text: lineText, originalIndex });
        } else {
            currentBlock = { icao: '', lines: [] };
            currentBlock.lines.push({ text: lineText, originalIndex });
        }
    });
    if (currentBlock) {
        airportBlocks.push(currentBlock);
    }
    
    const result = rawLines.map(line => ({ text: line, highlight: false }));
    const depDay = parseInt(flightData.flightDay || '08', 10);
    
    function parseDay(dayStr) {
        const d = parseInt(dayStr, 10);
        if (depDay >= 28 && d <= 5) return d + 30;
        if (depDay <= 5 && d >= 25) return d - 30;
        return d;
    }
    
    airportBlocks.forEach(block => {
        if (allowedIcaos && block.icao && !allowedIcaos.includes(block.icao)) return;
        const lines = block.lines;
        if (lines.length === 0) return;
        
        const etaInfo = getAirportEta(block.icao || flightData.to);
        const targetDayVal = parseDay(etaInfo.day);
        const [tHour, tMin] = etaInfo.time.split(':').map(Number);
        const targetMin = targetDayVal * 1440 + tHour * 60 + tMin;
        
        const windowMin = windowHours * 60;
        const etaStart = targetMin - windowMin;
        const etaEnd = targetMin + windowMin;
        
        let tStart = null;
        let tEnd = null;
        
        const firstLine = lines[0].text;
        const tafMatch = firstLine.match(/\bTAF\s+(?:AMD\s+|COR\s+)?([A-Z]{4})\s+\d{6}Z\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/i) ||
                         firstLine.match(/\b([A-Z]{4})\s+\d{6}Z\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/i);
        if (tafMatch) {
            const startDay = parseDay(tafMatch[2]);
            const startHour = parseInt(tafMatch[3], 10);
            const endDay = parseDay(tafMatch[4]);
            const endHour = parseInt(tafMatch[5], 10);
            tStart = startDay * 1440 + startHour * 60;
            tEnd = endDay * 1440 + endHour * 60;
        } else {
            tStart = depDay * 1440;
            tEnd = (depDay + 2) * 1440;
        }
        
        const parsedLines = lines.map((item, idx) => {
            const line = item.text.trim();
            let type = 'MAIN';
            let start = null;
            let end = null;
            
            const fmMatch = line.match(/\bFM(\d{2})(\d{2})(\d{2})\b/i);
            if (fmMatch) {
                type = 'FM';
                const day = parseDay(fmMatch[1]);
                const hour = parseInt(fmMatch[2], 10);
                const min = parseInt(fmMatch[3], 10);
                start = day * 1440 + hour * 60 + min;
            } else {
                const becmgMatch = line.match(/\bBECMG\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/i);
                if (becmgMatch) {
                    type = 'BECMG';
                    const day1 = parseDay(becmgMatch[1]);
                    const hour1 = parseInt(becmgMatch[2], 10);
                    start = day1 * 1440 + hour1 * 60;
                } else {
                    const tempoMatch = line.match(/\bTEMPO\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/i);
                    if (tempoMatch) {
                        type = 'TEMPO';
                        const day1 = parseDay(tempoMatch[1]);
                        const hour1 = parseInt(tempoMatch[2], 10);
                        const day2 = parseDay(tempoMatch[3]);
                        const hour2 = parseInt(tempoMatch[4], 10);
                        start = day1 * 1440 + hour1 * 60;
                        end = day2 * 1440 + hour2 * 60;
                    } else {
                        const probMatch = line.match(/\bPROB\d{2}\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/i);
                        if (probMatch) {
                            type = 'PROB';
                            const day1 = parseDay(probMatch[1]);
                            const hour1 = parseInt(probMatch[2], 10);
                            const day2 = parseDay(probMatch[3]);
                            const hour2 = parseInt(probMatch[4], 10);
                            start = day1 * 1440 + hour1 * 60;
                            end = day2 * 1440 + hour2 * 60;
                        }
                    }
                }
            }
            
            return { originalIndex: item.originalIndex, type, start, end, idx };
        });
        
        const persistent = parsedLines.filter(l => l.type === 'MAIN' || l.type === 'FM' || l.type === 'BECMG');
        const startLines = persistent.filter(l => l.start !== null || l.idx === 0);
        if (startLines.length > 0 && startLines[0].start === null) {
            startLines[0].start = tStart;
        }
        startLines.sort((a, b) => a.start - b.start);
        
        for (let i = 0; i < startLines.length; i++) {
            const current = startLines[i];
            const next = startLines[i + 1];
            current.end = next ? next.start : tEnd;
        }
        
        let lastStartLine = null;
        parsedLines.forEach(l => {
            if (l.type === 'MAIN' && l.idx === 0) {
                l.start = tStart;
                l.end = startLines[0].end;
                lastStartLine = l;
            } else if (l.type === 'FM' || l.type === 'BECMG') {
                const sl = startLines.find(x => x.idx === l.idx);
                if (sl) {
                    l.start = sl.start;
                    l.end = sl.end;
                    lastStartLine = l;
                }
            } else if (l.type === 'TEMPO' || l.type === 'PROB') {
                // Keep its own start and end
            } else {
                if (lastStartLine) {
                    l.start = lastStartLine.start;
                    l.end = lastStartLine.end;
                    l.type = lastStartLine.type;
                }
            }
        });
        
        parsedLines.forEach(l => {
            const start = l.start;
            const end = l.end;
            if (start !== null && end !== null) {
                const overlaps = (start <= etaEnd && end >= etaStart);
                if (overlaps) {
                    result[l.originalIndex].highlight = true;
                }
            }
        });
    });
    
    if (allowedIcaos) {
        const allowedIndices = new Set();
        airportBlocks.forEach(block => {
            if (!block.icao || allowedIcaos.includes(block.icao)) {
                block.lines.forEach(l => allowedIndices.add(l.originalIndex));
            }
        });
        return result.filter((_, idx) => allowedIndices.has(idx));
    }

    return result;
}

function parseFlightPlanRoute(routeStr) {
    let tokens = routeStr.split(/\s+/).filter(t => t.length > 0);
    if (tokens.length > 0 && tokens[0].match(/^\-[NKM]\d{3,4}[FSAM]\d{3,4}/)) {
        tokens.shift(); // remove the initial speed/level token
    }
    
    // clean speed/level suffixes from waypoints, e.g. RBL/N0490F340 -> RBL
    let cleanedTokens = tokens.map(t => t.split('/')[0]);
    
    function isWaypoint(t) {
        if (t === 'DCT') return false;
        if (t.match(/^\d{2}[NS]\d{3}[EW]$/i)) return true;
        if (t.match(/^[A-Z]{2,5}$/i)) return true;
        return false;
    }
    
    function isAirway(t) {
        if (t === 'DCT') return true;
        if (t.match(/^[A-Z]\d+$/i)) return true;
        if (t.match(/^[A-Z]+\d+[A-Z]*$/i)) return true;
        return false;
    }
    
    let routePairs = [];
    let expecting = 'AWY';
    let currentAwy = '';
    
    for (let i = 0; i < cleanedTokens.length; i++) {
        let t = cleanedTokens[i];
        if (expecting === 'AWY') {
            if (isWaypoint(t) && !isAirway(t)) {
                currentAwy = 'DCT';
                routePairs.push({ airway: currentAwy, waypoint: t });
                expecting = 'AWY';
            } else {
                currentAwy = t;
                expecting = 'WPT';
            }
        } else {
            if (isAirway(t) && !isWaypoint(t)) {
                currentAwy = t;
            } else {
                routePairs.push({ airway: currentAwy, waypoint: t });
                expecting = 'AWY';
            }
        }
    }
    return routePairs;
}

function findWaypointDistTime(fullText, wptName) {
    if (!fullText || !wptName) return null;
    const lines = fullText.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith(wptName)) {
            const match = line.match(/(\d{2})\.(\d{2})\s+(\d{3,4})\//);
            if (match) {
                return {
                    hours: parseInt(match[1], 10),
                    minutes: parseInt(match[2], 10),
                    dist: parseInt(match[3], 10)
                };
            }
        }
    }
    return null;
}

function addTimeToEtd(etdStr, elapsedHours, elapsedMinutes) {
    if (!etdStr) return '---';
    const parts = etdStr.split(':');
    if (parts.length !== 2) return '---';
    
    let hours = parseInt(parts[0], 10);
    let minutes = parseInt(parts[1], 10);
    
    minutes += elapsedMinutes;
    hours += elapsedHours + Math.floor(minutes / 60);
    minutes = minutes % 60;
    hours = hours % 24;
    
    const hStr = String(hours).padStart(2, '0');
    const mStr = String(minutes).padStart(2, '0');
    return `${hStr}:${mStr}`;
}

function parseStepAlts(routeStr, fromAirport, fullText) {
    let tokens = routeStr.split(/\s+/).filter(t => t.length > 0);
    let initialFL = 'FL350';
    if (tokens.length > 0 && tokens[0].match(/^\-[NKM]\d{3,4}[FSAM]\d{3,4}/)) {
        const match = tokens[0].match(/^\-[NKM]\d{3,4}([FSAM])(\d{3,4})/);
        if (match) {
            initialFL = 'FL' + match[2];
        }
    }
    const steps = [];
    steps.push({
        wpt: fromAirport || '----',
        alt: initialFL,
        dist: '---',
        time: flightData.etd || '---'
    });
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const match = token.match(/^([A-Z0-9]+)\/[NKM]\d{3,4}([FSAM])(\d{3,4})/i);
        if (match) {
            const wpt = match[1].toUpperCase();
            const alt = 'FL' + match[3];
            let dist = '---';
            let time = '---';
            const info = findWaypointDistTime(fullText, wpt);
            if (info) {
                dist = `${info.dist} NM`;
                time = addTimeToEtd(flightData.etd, info.hours, info.minutes);
            }
            steps.push({
                wpt: wpt,
                alt: alt,
                dist: dist,
                time: time
            });
        }
    }
    if (steps.length === 1) {
        steps.push({ wpt: '--------', alt: '---', dist: '', time: '' });
    }
    return steps;
}

function extractFplDepRouteArr(fplBlockText) {
    const lines = fplBlockText.split('\n').map(l => l.trim());
    let dep = '', arr = '', routeStr = '';
    let inRoute = false;
    for (const line of lines) {
        const depMatch = line.match(/^-([A-Z]{4})(\d{4})$/);
        if (depMatch && !dep) { dep = depMatch[1]; continue; }
        if (line.match(/^-[NKM]\d{3,4}[FSAM]\d{3,4}/)) {
            inRoute = true;
            routeStr += line + ' ';
            continue;
        }
        if (inRoute) {
            if (line.startsWith('-')) {
                const arrMatch = line.match(/^-([A-Z]{4})(\d{4})\b/);
                if (arrMatch) arr = arrMatch[1];
                inRoute = false;
                continue;
            }
            routeStr += line + ' ';
        }
    }
    return { dep, arr, route: routeStr.trim().replace(/\s+/g, ' ') };
}

function extractAtsFplComparisonResult(fullText) {
    // OFP 안에 "(FPL-<편명>-I..." 블록이 두 번 나오는 경우(디스패치 릴리스용 + ATS FPL 사본)
    // 출발공항/루트/도착공항을 서로 비교해서 일치 여부를 판정
    const fplRe = /\(FPL-[A-Z0-9]+-I[\s\S]*?\)/g;
    const blocks = [];
    let m;
    while ((m = fplRe.exec(fullText)) !== null) blocks.push(m[0]);
    if (blocks.length < 2) return null;
    const a = extractFplDepRouteArr(blocks[0]);
    const b = extractFplDepRouteArr(blocks[1]);
    const isMatch = a.dep === b.dep && a.arr === b.arr && a.route === b.route;
    return { isMatch, a, b };
}

function extractAltnRoute(fullText) {
    // "ROUTE TO ALTN : KLAX..LAX J96 PDZ..KONT"
    //   ".." = DCT(직항), 공백으로 구분된 토큰 = AIRWAY(예: J96).
    //   DEST(첫 공항)는 제외하고, PRIMARY RTEs와 동일하게 [AIRWAY, WAYPOINT] 쌍으로 묶어 표시.
    const m = fullText.match(/ROUTE TO ALTN\s*:\s*(.+)/i);
    if (!m) return [];
    // ".." → " DCT " 치환 후 공백 토큰화 → DEST 제외
    const tokens = m[1].trim().replace(/\.\./g, ' DCT ').split(/\s+/).filter(Boolean);
    tokens.shift();
    // 토큰은 (AIRWAY, WAYPOINT) 순으로 교대 → 2개씩 쌍으로 묶음
    const pairs = [];
    for (let i = 0; i < tokens.length; i += 2) {
        const airway = tokens[i] || '';
        const waypoint = tokens[i + 1] || '';
        if (waypoint) pairs.push({ airway, waypoint });
    }
    return pairs;
}

function formatLatLonDecimal(coord) {
    // "N40582" → "N4058.2" (마지막 자리 앞에 소수점)
    const m = (coord || '').match(/^([NSEW])(\d+)$/);
    if (!m) return coord || '';
    const digits = m[2];
    return m[1] + digits.slice(0, -1) + '.' + digits.slice(-1);
}

function extractLolvEtpData(fullText) {
    // "LOLV EQUAL TIME POINT DATA" 블록에서 ETP 구간(예: RJCC-PANC)과 좌표(LAT/LONG)를 순서대로 매칭.
    // 실제 유효한 ETP는 보통 2~3개뿐이며, 좌표 개수만큼만 잘라내면 그 뒤에 섞여 들어오는
    // (좌표 없는) 무관한 구간 라벨이 자동으로 걸러짐.
    const lolvRe = /LOLV\s+EQUAL TIME POINT DATA([\s\S]*?)(?=\n\s*\n\s*I HEREBY|$)/i;
    const m = fullText.match(lolvRe);
    if (!m) return [];
    const block = m[1];
    // 공항 구간은 항상 4자리 ICAO 코드 — ICN/SYD/DAD/CAN 같은 3자리(IATA류) 코드는 제외
    const pairRe = /\b([A-Z]{4})-([A-Z]{4})\b/g;
    const pairs = [];
    let pm;
    while ((pm = pairRe.exec(block)) !== null) pairs.push({ from: pm[1], to: pm[2] });
    const llRe = /LAT\/LONG\s+([NS]\d{4,6})\s+([EW]\d{5,7})/g;
    const coords = [];
    let lm;
    while ((lm = llRe.exec(block)) !== null) coords.push({ lat: lm[1], lon: lm[2] });
    // 유효한 ETP는 보통 2~4개뿐 — 그 이상은 무관한 참고용 데이터이므로 최대 4개로 제한.
    // 또한 좌표가 이전 항목과 완전히 동일하면(우연히 매칭된 무관한 구간 라벨) 건너뛴다.
    const maxEntries = Math.min(4, pairs.length, coords.length);
    const seenCoords = new Set();
    const result = [];
    for (let i = 0; i < maxEntries; i++) {
        const key = coords[i].lat + ' ' + coords[i].lon;
        if (seenCoords.has(key)) continue;
        seenCoords.add(key);
        result.push({
            from: pairs[i].from, to: pairs[i].to,
            lat: formatLatLonDecimal(coords[i].lat),
            lon: formatLatLonDecimal(coords[i].lon)
        });
    }
    return result;
}

function extractEraValidationData(fullText) {
    // "3% CONTINGENCY ERA VALIDATION" 블록 — ERA 공항 코드 + COC 좌표(이미 10진법으로 표기됨)
    const m = fullText.match(/3%\s+CONTINGENCY ERA VALIDATION([\s\S]*?)-{3,}/i);
    if (!m) return [];
    const block = m[1];
    const re = /\b([A-Z]{4})\s+([NS]\d+\.\d)\s+\d+\s+\d+\s+\d+\s+\d+\s+[\d.]+\s+\d+\s*\n\s*([EW]\d+\.\d)/g;
    const out = [];
    let mm;
    while ((mm = re.exec(block)) !== null) {
        out.push({ era: mm[1], lat: mm[2], lon: mm[3] });
    }
    return out;
}

function extractRefileFltPlanData(fullText) {
    // "REFILE FLT PLAN <편명> <날짜>" 블록 — 좌/우 두 구간이 같은 줄에 나란히 있어
    // 헤더 줄에서 두 번째 구간이 시작하는 컬럼 위치를 찾아 좌/우를 분리해서 각각 파싱한다.
    const headerMatch = fullText.match(/REFILE FLT PLAN\s+([A-Z0-9]+)\s+(\d{1,2}\/[A-Z]{3}\/\d{2})/i);
    if (!headerMatch) return null;
    const blockMatch = fullText.slice(headerMatch.index).match(/^[\s\S]*?(?=\nDIST\s+LATITUDE|$)/i);
    const block = blockMatch ? blockMatch[0] : '';
    const blockLines = block.split('\n');

    const segHeaderLine = blockLines.find(l => /-\s+[A-Z0-9]{2,6}\s+TO\s+[A-Z0-9]{2,6}/.test(l));
    let splitCol = null;
    if (segHeaderLine) {
        const matches = [...segHeaderLine.matchAll(/-\s+[A-Z0-9]{2,6}\s+TO\s+[A-Z0-9]{2,6}/g)];
        if (matches.length >= 2) splitCol = matches[1].index;
    }

    const leftText  = splitCol != null ? blockLines.map(l => l.slice(0, splitCol)).join('\n') : block;
    const rightText = splitCol != null ? blockLines.map(l => l.slice(splitCol)).join('\n') : '';

    function parseHalf(text) {
        const segMatch = text.match(/-\s+([A-Z0-9]{2,6})\s+TO\s+([A-Z0-9]{2,6})/);
        const rqrdMatch = text.match(/RQRD\s+(\d{3,6})\s+[\d.]+/);
        const plannedMatch = text.match(/PLANNED R\/F AT REFILE POINT\s+(\d{3,6})/i);
        return {
            from: segMatch ? segMatch[1] : '',
            to: segMatch ? segMatch[2] : '',
            rqrd: rqrdMatch ? (parseInt(rqrdMatch[1], 10) / 10).toFixed(1) : '',
            plannedRf: plannedMatch ? (parseInt(plannedMatch[1], 10) / 10).toFixed(1) : ''
        };
    }

    const left = parseHalf(leftText);
    const right = splitCol != null ? parseHalf(rightText) : { from: '', to: '', rqrd: '', plannedRf: '' };

    const segments = [left, right].filter(s => s.from && s.to).map(s => ({ from: s.from, to: s.to, rqrd: s.rqrd }));
    const plannedRf = left.plannedRf || right.plannedRf || '';

    // "RIF/LEWIT..44N00..4290N..4080N..KIAD" — 마지막에 표시할 RIF 루트
    const rifMatch = block.match(/RIF\/([^\n]+)/i);
    const rifRoute = rifMatch ? rifMatch[1].trim().replace(/\.\./g, ' DCT ') : '';

    return { fltNbr: headerMatch[1], date: headerMatch[2], segments, plannedRf, rifRoute };
}

function extractTurbulenceZones(wpts) {
    let zones = [];
    let currentZone = [];

    for (let i = 0; i < wpts.length; i++) {
        const pt = wpts[i];
        const sr = parseInt(pt.sr, 10);
        
        if (sr >= 4) {
            currentZone.push(pt);
        } else {
            if (currentZone.length > 0) {
                zones.push(currentZone);
                currentZone = [];
            }
        }
    }
    if (currentZone.length > 0) {
        zones.push(currentZone);
    }
    
    const formattedZones = zones.map(zone => {
        const startPt = zone[0];
        const endPt = zone[zone.length - 1];
        
        const srs = zone.map(p => parseInt(p.sr, 10));
        const minSr = Math.min(...srs);
        const maxSr = Math.max(...srs);
        const srStr = minSr === maxSr ? String(minSr).padStart(2, '0') : `${String(minSr).padStart(2, '0')}-${String(maxSr).padStart(2, '0')}`;
        
        const hasRed = srs.some(s => s >= 7);
        const color = hasRed ? 'var(--text-red)' : 'var(--text-green)';
        
        const formatActm = (actmStr) => {
            return actmStr.replace('.', '+');
        };
        
        const startActm = formatActm(startPt.actm);
        const endActm = formatActm(endPt.actm);
        const actmStr = startPt.actm === endPt.actm ? startActm : `${startActm} / ${endActm}`;
        const label = startPt.wpt === endPt.wpt ? startPt.wpt : `${startPt.wpt} / ${endPt.wpt}`;
        
        return {
            label,
            sr: srStr,
            time: actmStr,
            color
        };
    });
    
    return formattedZones;
}

function extractWeatherSection(fullText, headerName) {
    const headerIdx = fullText.toUpperCase().indexOf(headerName.toUpperCase());
    if (headerIdx === -1) return [];
    
    const remainingText = fullText.substring(headerIdx + headerName.length);
    const firstDividerMatch = remainingText.match(/\-{5,}/);
    if (!firstDividerMatch) return [];
    
    const weatherStartIdx = firstDividerMatch.index + firstDividerMatch[0].length;
    const weatherText = remainingText.substring(weatherStartIdx);
    
    const lines = [];
    const rawLines = weatherText.split('\n');
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i].trim();
        if (line.match(/^Page\s+\d+/i)) {
            continue;
        }
        if (headerName.toUpperCase() === 'ENROUTE WEATHER') {
            const lowerLine = line.toLowerCase();
            const noSpaceLine = lowerLine.replace(/\s+/g, '');
            if (noSpaceLine.includes('wintem') || 
                noSpaceLine.includes('sigwx') || 
                noSpaceLine.includes('sigchart') || 
                noSpaceLine.includes('notam') || 
                noSpaceLine.includes('planvalid') || 
                noSpaceLine.includes('averagewind') || 
                noSpaceLine.includes('herebyrelease') || 
                noSpaceLine.includes('mel/cdlitems')) {
                break;
            }
        } else {
            if (line.match(/^\-{5,}$/)) {
                break;
            }
        }
        if (line.length > 0) {
            lines.push(line);
        }
    }
    return lines;
}

// ── NOTAM parsing ────────────────────────────────────────────────

function extractRunwayInfo(text) {
    // Capture runway dimension block: everything after "RUNWAY :" until next bullet section
    const m = text.match(/RUNWAY\s*:\s*([^\n◼▪■]+(?:\n[^\n◼▪■]+)*)/i);
    if (!m) return [];
    // Split by lines and keep only lines that describe a runway pair (e.g. "16L/34R : 13123FT X 197FT")
    const lines = m[1].split('\n');
    const results = [];
    for (const line of lines) {
        const trimmed = line.trim();
        // Must match runway designator pattern: digits + optional L/C/R, slash, digits + optional L/C/R
        if (/\d+[LCR]?\/\d+[LCR]?\s*:/i.test(trimmed)) {
            results.push(trimmed.replace(/\s+/g, ' '));
        }
    }
    return results;
}

function extractNotamPackage1(fullText) {
    // Locate NOTAM PACKAGE 1 block — flexible keyword match
    const pkg1Re = /NOTAM\s+P(?:ACKAGE|KG|KGE)\.?\s*[#№]?\s*1\b[\s\S]*?(?=NOTAM\s+P(?:ACKAGE|KG|KGE)\.?\s*[#№]?\s*2\b|END\s+OF\s+(?:NOTAM\s+)?P(?:ACKAGE|KG|KGE)\.?\s*1|$)/i;
    const pkg1Match = fullText.match(pkg1Re);
    if (!pkg1Match) {
        console.warn('[NOTAM] PACKAGE 1 block not found in this OFP. Snippet:', fullText.slice(0, 300));
        return;
    }
    const pkg1 = pkg1Match[0];
    console.log('[NOTAM] PACKAGE 1 found, length:', pkg1.length);

    // Split into [DEP], [DEST], [ALTN] sections
    const secRe = /\[(DEP|DEST|ALTN)\][\s\S]*?(?=\[DEP\]|\[DEST\]|\[ALTN\]|$)/gi;
    let m;
    let found = 0;
    while ((m = secRe.exec(pkg1)) !== null) {
        const tag  = m[0].match(/\[(DEP|DEST|ALTN)\]/i)[1].toUpperCase();
        const body = m[0];
        const entries   = parseNotamSection(body);
        const rwInfo    = extractRunwayInfo(body);
        console.log(`[NOTAM] [${tag}] parsed ${entries.length} entries`);
        if (tag === 'DEP')  { flightData.depNotamEntries  = entries; flightData.depRunwayInfo  = rwInfo; }
        if (tag === 'DEST') { flightData.arrNotamEntries  = entries; flightData.arrRunwayInfo  = rwInfo; }
        if (tag === 'ALTN') { flightData.altnNotamEntries = entries; flightData.altnRunwayInfo = rwInfo; }
        found++;
    }
    if (found === 0) {
        console.warn('[NOTAM] PACKAGE 1 found but no [DEP]/[DEST]/[ALTN] sections inside. Snippet:', pkg1.slice(0, 400));
    }
}

function parseNotamSection(text) {
    const entries = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let currentCat = 'GENERAL';
    let cur = null;

    // Standard NOTAM header: "16APR26 08:13 - 10JUN26 15:00 RKSI A0478/26"
    const hdrRe = /^(\d{2}[A-Z]{3}\d{2}\s+\d{2}:\d{2})\s*-\s*(UFN|\d{2}[A-Z]{3}\d{2}\s+\d{2}:\d{2})\s+([A-Z]{4})\s+([A-Z0-9/]+)$/i;
    // COMPANY ADVISORY header: "1. 26JUN24 15:00 - UFN    RJCC COAD01/24"
    const coAdHdrRe = /^\d+\.\s+(\d{2}[A-Z]{3}\d{2}\s+\d{2}:\d{2})\s*-\s*(UFN|\d{2}[A-Z]{3}\d{2}\s+\d{2}:\d{2})\s+([A-Z]{4})\s+([A-Z0-9/]+)/i;

    const save = () => { if (cur) { entries.push(cur); cur = null; } };

    for (const line of lines) {
        // Category header (◼ symbol or solid square)
        if (/◼|▪|■/.test(line)) {
            save();
            currentCat = line.replace(/[◼▪■]/g, '').trim().toUpperCase();
            continue;
        }
        // Try standard header first
        let hm = line.match(hdrRe);
        if (!hm && currentCat === 'COMPANY ADVISORY') {
            hm = line.match(coAdHdrRe);
        }
        if (hm) {
            save();
            cur = { cat: currentCat, dateStart: hm[1], dateEnd: hm[2], icao: hm[3], id: hm[4], sched: '', desc: '' };
            continue;
        }
        if (cur) {
            if (line.startsWith('D)'))       cur.sched = line.replace(/^D\)\s*/, '');
            else if (line.startsWith('E)'))  cur.desc  = line.replace(/^E\)\s*/, '');
            else if (line.startsWith('COMMENT)')) { /* skip */ }
            // COMPANY ADVISORY content lines start with "- " or "** "
            else if (currentCat === 'COMPANY ADVISORY' && /^-{1,2}\s|^\*\*/.test(line)) {
                const content = line.replace(/^-{1,2}\s*/, '').replace(/^\*\*\s*/, '').replace(/\s*\*\*$/, '');
                if (content && !content.startsWith('BY ') && !/^BY\s+\w+--/.test(content)) {
                    cur.desc += (cur.desc ? ' / ' : '') + content;
                }
            }
            else if (cur.desc && !/^[A-Z]\)/.test(line) && !/^\d{2}[A-Z]{3}\d{2}/.test(line) && !/^\d+\.\s+\d{2}[A-Z]{3}/.test(line))
                cur.desc += ' ' + line;
        }
    }
    save();
    // Keyword-based reclassification: correct category when ◼ bullet is missed or
    // encoded differently by PDF.js. Runs on ALL entries as a safety net.
    const KNOWN_CATS = new Set([
        'APPROACH','APPROACH LIGHT','RUNWAY','RUNWAY LIGHT','DEPARTURE',
        'TAXIWAY','TAXIWAY LIGHT','NAVAID','GPS','RAMP','AIRPORT',
        'COMPANY ADVISORY','OBSTRUCTION','OTHER'
    ]);
    for (const e of entries) {
        const d = (e.desc || '').toUpperCase();
        const catOk = KNOWN_CATS.has(e.cat);

        // Always reclassify APPROACH/DEPARTURE regardless of current cat (encoding issues)
        if (/^IAP\b|^ILS\s+(?:OR\s+LOC\s+)?RWY|^RNAV\s*\((?:GPS|RNP)\)\s+[A-Z]\s+RWY|^VOR\s+RWY|^LOC\s+RWY|^PAPI\b|MISSED\s+APPROACH/.test(d)) {
            e.cat = 'APPROACH';
        } else if (/^(?:[A-Z]{3,4}\s+)?(?:NAV\s+)?ILS\s+RWY\s+\d/.test(d)) {
            e.cat = 'APPROACH';
        } else if (/^(?:[A-Z]{3,4}\s+)?(?:NAV\s+)?(?:ILS\s+OR\s+LOC\s+RWY|RNAV\s*\([GR](?:PS|NP)\))/.test(d)) {
            e.cat = 'APPROACH';
        } else if (/^SID\b|^[A-Z]{3,4}\s+SID\b|^ODP\b|^[A-Z]{3,4}\s+ODP\b/.test(d)) {
            e.cat = 'DEPARTURE';
        } else if (!catOk) {
            // Fallback for entries with unrecognised category (bullet not parsed)
            if (/\bALS\b|APCH\s+LGT|APPROACH\s+LIGHT/.test(d))          e.cat = 'APPROACH LIGHT';
            else if (/\bRWY\s+\d|RUNWAY\s+\d|DECLARED\s+DIST|TORA\b|TODA\b|ASDA\b|LDA\b/.test(d)) e.cat = 'RUNWAY';
            else if (/\bTWY\s+[A-Z]|\bTAXIWAY\b/.test(d))               e.cat = 'TAXIWAY';
            else if (/\bAPRON\b|\bRAMP\b|\bSTAND\s+NR\b|\bGATE\s+\d/.test(d)) e.cat = 'RAMP';
            else if (/\bVOR\b|\bNDB\b|\bTACAN\b|\bDME\b|\bILS\b|\bLLZ\b/.test(d)) e.cat = 'NAVAID';
            else if (/\bGPS\b|\bRAIM\b|\bGNSS\b/.test(d))               e.cat = 'GPS';
            else if (/\bCRANE\b|\bOBST\b/.test(d))                      e.cat = 'OBSTRUCTION';
            else                                                           e.cat = 'OTHER';
        }
    }
    return entries;
}

function extractNotamPackage2(fullText) {
    // Locate NOTAM PACKAGE 2 block
    const pkg2Re = /NOTAM\s+P(?:ACKAGE|KG|KGE)\.?\s*[#№]?\s*2\b[\s\S]*?(?=NOTAM\s+P(?:ACKAGE|KG|KGE)\.?\s*[#№]?\s*3\b|END\s+OF\s+(?:NOTAM\s+)?P(?:ACKAGE|KG|KGE)\.?\s*2|$)/i;
    const pkg2Match = fullText.match(pkg2Re);
    if (!pkg2Match) {
        console.warn('[NOTAM] PACKAGE 2 block not found.');
        return;
    }
    const pkg2 = pkg2Match[0];
    console.log('[NOTAM] PACKAGE 2 found, length:', pkg2.length);

    // Split by [ETP] section headers.
    // Header examples:
    //   [ETP] RJCC / CTS / Sapporo New Chitose Airport
    //   [ETP] PANC / ANC / Ted Stevens Anchorage International Airport
    // Also handle "ETP :" table lines at the top of the package (informational — not parsed as NOTAM sections).
    const etpRe = /(\[ETP\][^\n]*)\n([\s\S]*?)(?=\[ETP\]|$)/gi;
    flightData.etpNotamSections = [];
    let m;
    while ((m = etpRe.exec(pkg2)) !== null) {
        const title = m[1].trim();
        const body = m[2];
        const entries = parseNotamSection(body);
        console.log(`[NOTAM] ETP section "${title}" parsed ${entries.length} entries`);
        flightData.etpNotamSections.push({ title, entries });
    }
    console.log(`[NOTAM] PACKAGE 2: total ${flightData.etpNotamSections.length} ETP sections`);
}

function extractNotamPackage3(fullText) {
    // PACKAGE 3 블록 추출: "NOTAM PACKAGE 3" ~ "END OF NOTAM PACKAGE 3" 또는 EOF
    const pkg3Re = /NOTAM\s+P(?:ACKAGE|KG|KGE)\.?\s*[#№]?\s*3\b[\s\S]*?(?=END\s+OF\s+(?:NOTAM\s+)?P(?:ACKAGE|KG|KGE)\.?\s*3|$)/i;
    const pkg3Match = fullText.match(pkg3Re);
    if (!pkg3Match) {
        console.warn('[NOTAM] PACKAGE 3 block not found.');
        flightData.firNotamSections = [];
        return;
    }
    const pkg3 = pkg3Match[0];
    console.log('[NOTAM] PACKAGE 3 found, length:', pkg3.length);

    // FIR 코드 목록을 헤더에서 추출: "FIR: RKRR RJJJ KZAK KZOA KZLA"
    const firListMatch = pkg3.match(/FIR\s*:\s*([A-Z]{4}(?:\s+[A-Z]{4})*)/i);
    const firListStr = firListMatch ? firListMatch[1] : '';
    const expectedFirs = firListStr ? firListStr.trim().split(/\s+/) : [];
    console.log('[NOTAM] Expected FIRs:', expectedFirs);

    // [FIR] ICAO / 공항명 형식의 섹션으로 분리
    // 예: "[FIR] RKRR/ Incheon, KR" 또는 "[FIR] RJJJ/ Fukuoka, JP"
    const firSecRe = /(\[FIR\]\s*[A-Z]{4}[^\n]*)\n([\s\S]*?)(?=\[FIR\]\s*[A-Z]{4}|$)/gi;
    flightData.firNotamSections = [];
    let m;
    while ((m = firSecRe.exec(pkg3)) !== null) {
        const header = m[1].trim();
        const body   = m[2];

        // FIR ICAO 코드 추출: "[FIR] RKRR/ Incheon" → "RKRR"
        const icaoMatch = header.match(/\[FIR\]\s*([A-Z]{4})/i);
        const fir = icaoMatch ? icaoMatch[1].toUpperCase() : 'UNKN';

        // 원문 텍스트 보존 (AI 요약용)
        const rawText = body.trim();

        flightData.firNotamSections.push({ fir, header, rawText });
        console.log(`[NOTAM] FIR section "${fir}" length: ${rawText.length}`);
    }
    console.log(`[NOTAM] PACKAGE 3: total ${flightData.firNotamSections.length} FIR sections`);

    // 파싱 완료 후 AI 요약 호출
    if (flightData.firNotamSections.length > 0) {
        callFirNotamAiSummary();
    }
}

// ── FIR NOTAM AI 요약 (Claude API) ─────────────────────────────────

async function callFirNotamAiSummary() {
    flightData.firAiStatus = 'loading';
    flightData.firAiSummary = '';

    // FIR NOTAM 탭이 열려 있으면 로딩 상태 즉시 반영
    if (activeEraFirNotamTab === 'FIR') {
        const tbody = document.querySelector('#era-fir-notam-table-body');
        if (tbody) tbody.innerHTML = getFirNotamTableHTML();
    }

    // PACKAGE 3 전체 원문 합산 (FIR별 구분선 포함)
    const pkg3Text = flightData.firNotamSections
        .map(s => `=== FIR: ${s.fir} ===\n${s.rawText}`)
        .join('\n\n');

    const firList = flightData.firNotamSections.map(s => s.fir).join(', ');
    const fltInfo = `편명: ${flightData.fltNbr || '-'}, 출발: ${flightData.from || '-'}, 도착: ${flightData.to || '-'}, ETD: ${flightData.etd || '-'}Z, ETA: ${flightData.eta || '-'}Z`;

    const prompt = `당신은 상업항공 A380 기장을 위한 비행 전 NOTAM 브리핑 어시스턴트입니다.

비행 정보: ${fltInfo}
통과 FIR: ${firList}

아래는 OFP NOTAM PACKAGE 3의 FIR NOTAM 원문입니다.

---
${pkg3Text}
---

다음 규칙에 따라 한국어로 요약하세요:

1. FIR별로 구분하여 제목을 표시 (예: ▶ RKRR (인천 FIR))
2. 각 FIR에서 A380 운항에 실질적 영향을 주는 NOTAM만 선별
3. 영향도 순으로 정렬: ①공역제한/항로폐쇄 ②GPS/RAIM 장애 ③흐름통제(Flow Control) ④기타
4. 각 항목은 2~3줄 이내로 핵심만 요약
5. 운항 영향이 없는 NOTAM(참고용, 항공기 등록 변경 등)은 제외
6. "NO SIGNIFICANT NOTAM"인 FIR은 한 줄로 표시
7. 전체 응답은 최대 400단어 이내

※ 이 요약은 참고용 보조자료입니다. Primary NOTAM 소스는 Jeppesen Aviator 공식 브리핑입니다.`;

    try {
        const resp = await fetch(`${CKPT_PROXY_BASE}/notam-summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`API ${resp.status}: ${errText.slice(0, 120)}`);
        }

        const data = await resp.json();
        const summary = data?.content?.[0]?.text || '';
        if (!summary) throw new Error('응답 텍스트 없음');

        flightData.firAiSummary = summary;
        flightData.firAiStatus = 'done';

    } catch (err) {
        console.error('[FIR AI] 요약 실패:', err);
        flightData.firAiStatus = 'error';
        flightData.firAiSummary = `요약 실패: ${err.message}`;
    }

    // 결과 반영
    if (activeEraFirNotamTab === 'FIR') {
        const tbody = document.querySelector('#era-fir-notam-table-body');
        if (tbody) tbody.innerHTML = getFirNotamTableHTML();
        // 페이지 제목 업데이트 (FIR 수 표시)
        if (pageTitleText) {
            const cnt = flightData.firNotamSections.length;
            pageTitleText.textContent = `ACTIVE/ERA·FIR NOTAM`;
        }
    }
}

// ── FIR NOTAM 표시 ──────────────────────────────────────────────────

function buildFirNotamDisplayLines() {
    const status  = flightData.firAiStatus;
    const summary = flightData.firAiSummary;
    const sections = flightData.firNotamSections;
    const lines = [];

    if (!sections || sections.length === 0) {
        lines.push({ type: 'body', text: '  OFP에서 NOTAM PACKAGE 3를 찾지 못했습니다.' });
        lines.push({ type: 'body', text: '  (Aviator OFP PDF를 다시 IMPORT 하세요)' });
        return lines;
    }

    // 상태 헤더
    if (status === 'loading') {
        lines.push({ type: 'etp-title', text: '⏳  AI 요약 생성 중...' });
        lines.push({ type: 'blank', text: '' });
        lines.push({ type: 'body', text: '  Claude Sonnet이 FIR NOTAM을 분석하고 있습니다.' });
        lines.push({ type: 'body', text: '  잠시 기다려 주세요 (10~30초).' });
        return lines;
    }

    if (status === 'error') {
        lines.push({ type: 'hdr-amber', text: '⚠️  AI 요약 오류' });
        lines.push({ type: 'blank', text: '' });
        wrapText('  ' + (summary || '알 수 없는 오류'), 72).forEach(ln =>
            lines.push({ type: 'body', text: ln })
        );
        lines.push({ type: 'blank', text: '' });
        lines.push({ type: 'body', text: '  → IMPORT 후 재시도하거나 API 키를 확인하세요.' });
        return lines;
    }

    if (status === 'done' && summary) {
        // 면책 고지
        lines.push({ type: 'hdr-amber', text: '⚠️  보조자료 — Primary: Jeppesen Aviator' });
        lines.push({ type: 'blank', text: '' });

        // AI 요약 본문 — FIR 제목(▶)은 헤더로, 나머지는 body로
        const summaryLines = summary.split('\n');
        for (const sl of summaryLines) {
            const trimmed = sl.trim();
            if (!trimmed) {
                lines.push({ type: 'blank', text: '' });
            } else if (/^▶|^#{1,3}\s|^\*\*/.test(trimmed)) {
                // FIR 제목줄 → etp-title 스타일
                const clean = trimmed.replace(/^#{1,3}\s+/, '').replace(/^\*\*|\*\*$/g, '');
                lines.push({ type: 'etp-title', text: clean });
            } else {
                // 내용줄 — 74자 wrap
                wrapText('  ' + trimmed, 74).forEach(ln =>
                    lines.push({ type: 'body', text: ln })
                );
            }
        }
        return lines;
    }

    // idle (PDF 파싱됐지만 아직 API 호출 전 — 정상적으로 도달하지 않아야 함)
    lines.push({ type: 'body', text: '  FIR NOTAM 데이터 없음.' });
    return lines;
}

function getFirNotamTableHTML() {
    const lines = buildFirNotamDisplayLines();
    return renderNotamRows(lines, eraFirNotamScrollIndex);
}

// ══════════════════════════════════════════════════════════════════
//  METAR  —  aviationweather.gov  (무료, 키 없음, 15분 캐싱)
// ══════════════════════════════════════════════════════════════════

const CKPT_PROXY_BASE = 'https://airbus380cbt.com/ckpt-proxy';
const METAR_CACHE_MS = 15 * 60 * 1000; // 15분

async function fetchMetar() {
    const dep = (flightData.from || '').trim();
    const arr = (flightData.to  || '').trim();
    if (!dep || !arr) return;

    // 15분 캐싱 — 마지막 fetch 후 15분 미만이면 API 호출 생략
    const now = Date.now();
    if (flightData.metarCacheTime && (now - flightData.metarCacheTime) < METAR_CACHE_MS) {
        console.log('[METAR] Cache hit — skipping fetch');
        return;
    }

    console.log(`[METAR] Fetching for ${dep}, ${arr}`);
    const url = `${CKPT_PROXY_BASE}/metar?ids=${dep},${arr}`;

    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        flightData.depMetar = null;
        flightData.arrMetar = null;

        for (const m of data) {
            const icao = (m.icaoId || m.stationId || '').toUpperCase();
            const entry = {
                raw:             m.rawOb || m.rawMETAR || '',
                flight_category: m.flightCategory || m.flightCat || '',
                observed:        m.obsTime || m.reportTime || '',
                temp:            m.temp   != null ? m.temp   : null,
                dewp:            m.dewp   != null ? m.dewp   : null,
                wdir:            m.wdir   != null ? m.wdir   : null,
                wspd:            m.wspd   != null ? m.wspd   : null,
                visib:           m.visib  != null ? m.visib  : null,
                altim:           m.altim  != null ? m.altim  : null,  // hPa
            };
            if (icao === dep.toUpperCase()) flightData.depMetar = entry;
            if (icao === arr.toUpperCase()) flightData.arrMetar = entry;
        }

        flightData.metarCacheTime = now;
        console.log('[METAR] Done —', dep, flightData.depMetar?.raw?.slice(0, 40),
                                     arr, flightData.arrMetar?.raw?.slice(0, 40));

    } catch (err) {
        console.error('[METAR] fetch 실패:', err);
    }
}

function getMetarCategoryColor(cat) {
    switch ((cat || '').toUpperCase()) {
        case 'VFR':  return '#00e676';   // 초록
        case 'MVFR': return '#4fc3f7';   // 하늘색
        case 'IFR':  return '#ff6b6b';   // 빨강
        case 'LIFR': return '#ce93d8';   // 보라
        default:     return '#ffffff';
    }
}

function buildMetarRows(metarObj, label) {
    // FMS 스타일 2~3행으로 METAR 표시
    if (!metarObj || !metarObj.raw) {
        return `<tr style="height:22px;">
            <td style="padding:2px 6px; font-size:0.7rem; font-family:'Share Tech Mono',monospace; color:#666;">
                ${label} METAR — 데이터 없음 (인터넷 연결 확인)
            </td></tr>`;
    }
    const cat   = metarObj.flight_category || '';
    const color = getMetarCategoryColor(cat);
    const catBadge = cat
        ? `<span style="background:${color}22; color:${color}; border:1px solid ${color};
               border-radius:3px; padding:0 4px; font-size:0.65rem; margin-right:6px;">${cat}</span>`
        : '';

    // 관측시각 포맷: "2026-06-23T04:00:00Z" → "0400Z"
    let obsStr = '';
    if (metarObj.observed) {
        const d = new Date(metarObj.observed * 1000 || metarObj.observed);
        if (!isNaN(d)) {
            const hh = String(d.getUTCHours()).padStart(2,'0');
            const mm = String(d.getUTCMinutes()).padStart(2,'0');
            obsStr = `${hh}${mm}Z`;
        }
    }

    const raw = metarObj.raw || '';
    // 원문을 72자씩 줄바꿈
    const chunks = [];
    for (let i = 0; i < raw.length; i += 72) chunks.push(raw.slice(i, i + 72));

    let html = `<tr style="height:20px;">
        <td style="padding:1px 6px; font-size:0.68rem; font-family:'Share Tech Mono',monospace;">
            ${catBadge}<span style="color:#aaa;">${label} METAR ${obsStr ? '(' + obsStr + ')' : ''}</span>
        </td></tr>`;
    for (const chunk of chunks) {
        html += `<tr style="height:auto;">
            <td style="padding:1px 6px 3px; font-size:0.7rem; font-family:'Share Tech Mono',monospace;
                       color:${color}; word-break:break-all; line-height:1.35;">
                ${chunk}
            </td></tr>`;
    }
    html += `<tr style="height:6px;"><td></td></tr>`; // 구분 여백
    return html;
}

// ══════════════════════════════════════════════════════════════════
//  GATE  —  AeroDataBox via RapidAPI
// ══════════════════════════════════════════════════════════════════

async function fetchGate() {
    const fltNbr = (flightData.fltNbr || '').replace(/\s+/g, '').toUpperCase(); // "OZ202"
    const etdStr = flightData.etd || '';   // "03:40"
    const depDay = flightData.flightDay || '';  // "07"

    if (!fltNbr || !etdStr) {
        console.warn('[GATE] fltNbr 또는 ETD 없음');
        return;
    }

    flightData.gateStatus = 'loading';
    flightData.depGate = '';
    flightData.depTerminal = '';

    // AeroDataBox: GET /flights/number/{flightNumber}/{date}  (via 공용 프록시 — 키는 서버에만 보관)
    // date 형식: YYYY-MM-DD  (OFP flightDay가 DD형식이라 현재년월 붙임)
    const today = new Date();
    const yyyy  = today.getUTCFullYear();
    const mm    = String(today.getUTCMonth() + 1).padStart(2, '0');
    const dd    = depDay.padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const url = `${CKPT_PROXY_BASE}/gate?flightNumber=${fltNbr}&date=${dateStr}`;
    console.log('[GATE] Fetching:', url);

    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        // 응답은 배열 — ETD에 가장 가까운 편 선택
        const flights = Array.isArray(data) ? data : [data];
        let best = flights[0];
        if (flights.length > 1 && etdStr) {
            const [th, tm] = etdStr.split(':').map(Number);
            const etdMin = th * 60 + tm;
            best = flights.reduce((prev, cur) => {
                const parseMin = (s) => {
                    if (!s) return 9999;
                    const t = s.replace(/.*T/, '').replace('Z', '').slice(0, 5);
                    const [h, m] = t.split(':').map(Number);
                    return (h || 0) * 60 + (m || 0);
                };
                const pd = Math.abs(parseMin(prev?.departure?.scheduledTime?.utc) - etdMin);
                const cd = Math.abs(parseMin(cur?.departure?.scheduledTime?.utc)  - etdMin);
                return cd < pd ? cur : prev;
            });
        }

        const dep = best?.departure;
        flightData.depGate     = dep?.gate     || dep?.terminal?.gate     || '';
        flightData.depTerminal = dep?.terminal?.name || dep?.terminal || '';
        flightData.gateStatus  = 'done';

        console.log('[GATE] Done — Gate:', flightData.depGate, 'Terminal:', flightData.depTerminal);

        // INIT 페이지가 열려 있으면 게이트 표시 즉시 갱신
        const gateEl = document.getElementById('dep-gate-display');
        if (gateEl) {
            gateEl.textContent = buildGateLabel();
            gateEl.style.color = flightData.depGate ? 'var(--text-cyan)' : '#666';
        }

    } catch (err) {
        console.error('[GATE] fetch 실패:', err);
        flightData.gateStatus = 'error';
        flightData.depGate = 'ERR';
        const gateEl = document.getElementById('dep-gate-display');
        if (gateEl) { gateEl.textContent = 'GATE ERR'; gateEl.style.color = '#ff6b6b'; }
    }
}

function buildGateLabel() {
    const g = flightData.depGate;
    const s = flightData.gateStatus;
    if (s === 'loading') return '...';
    if (!g && s === 'done') return 'N/A';
    if (!g) return '---';
    return `G${g}`;
}

// ── Rule filtering ───────────────────────────────────────────────

function notamPassesRules(entry, airport, flightData) {
    const desc  = (entry.desc  || '').toUpperCase();
    const cat   = (entry.cat   || '').toUpperCase();

    // Rule 2: skip aircraft-type-specific NOTAMs
    if (/\bA220\s+ONLY\b|320\/321\s+ONLY/.test(desc)) return false;
    // Rule 1: skip RUNUP PAD (A380 cannot use)
    if (/RUN.?UP\s+PAD/.test(desc)) return false;

    // COMPANY ADVISORY: always show (operator-issued operational notices)
    if (cat === 'COMPANY ADVISORY') return true;

    // Rule 1.13: ALL DEPARTURE and APPROACH/IAP NOTAMs are shown — also catch by keyword
    // in case category was set incorrectly (PDF bullet encoding issue)
    const isApproach = cat === 'APPROACH' || /^IAP\b|^ILS\s+(OR\s+LOC\s+)?RWY|^RNAV\s*\(GPS\)\s+RWY|^VOR\s+RWY|^LOC\s+RWY/.test(desc);
    const isDeparture = cat === 'DEPARTURE' || /^SID\b|^JFK\s+SID\b/.test(desc);
    if (isApproach || isDeparture) return true;

    // Rule 4: skip CRANE / OBST / FLAGGED globally
    if (/\bCRANE\b|\bOBST\b|\bFLAGGED\b/.test(desc)) return false;

    // Rule 1-7: skip TAXIWAY NOTAMs that are Code F wingspan restrictions
    // (permanently restricted TWYs for Code F aircraft are pre-charted, not operationally useful)
    if (cat.includes('TAXIWAY')) {
        if (/\bCODE\s+F\b|\bWINGSPAN\s+MORE\s+THAN\b|\bWING\s+SPAN\s+MORE\s+THAN\b/.test(desc)) return false;
        // Rule 1-14: skip TWY lighting / sign / marking / barricade / dimmed notices (all airports)
        if (/\bLGT\b|\bLIGHT(?:ING|S)?\b|\bSIGN\b|\bMARKING[S]?\b|\bBARRICAD(?:ED|ING)?\b|\bDIMMED\b/.test(desc)) return false;
    }

    // Rule 4 (RKSI): only show NOTAMs for gates 266, 267, 268; skip all other gate/stand NOTAMs
    if (airport === 'RKSI') {
        const gateMatch = desc.match(/\b(?:GATE|STAND|SPOT|BAY|REMOTE)\s+(?:NR\s+)?(\d+)\b/);
        if (gateMatch) {
            const gateNum = parseInt(gateMatch[1], 10);
            if (![266, 267, 268].includes(gateNum)) return false;
        }
    }

    // Rule 5 (KLAX): only show NOTAMs for gates 148, 150, 152, 154, 156; skip all other gate/stand NOTAMs
    if (airport === 'KLAX') {
        const gateMatch = desc.match(/\b(?:GATE|STAND|SPOT|BAY|REMOTE|TXL\s+[A-Z]\d+\s+(?:NORTH|SOUTH|EAST|WEST)\s+OF\s+GATE)\s+(?:NR\s+)?(\d+[A-Z]?)\b/);
        if (gateMatch) {
            const gateStr = gateMatch[1].replace(/[A-Z]$/, '');
            const gateNum = parseInt(gateStr, 10);
            if (![148, 150, 152, 154, 156].includes(gateNum)) return false;
        }
    }

    // Rule 7 (RJAA): only show NOTAMs for gates 45, 46
    if (airport === 'RJAA') {
        const gateMatch = desc.match(/\b(?:GATE|STAND|SPOT|BAY|REMOTE)\s+(?:NR\s+)?(\d+)\b/);
        if (gateMatch) {
            const gateNum = parseInt(gateMatch[1], 10);
            if (![45, 46].includes(gateNum)) return false;
        }
    }

    // Rule 8 (RCTP): only show NOTAMs for gates C1-C6, D1-D6
    if (airport === 'RCTP') {
        const gateMatch = desc.match(/\b(?:GATE|STAND|SPOT|BAY|REMOTE)\s+(?:NR\s+)?([CD]\d{1,2})\b/);
        if (gateMatch) {
            if (!/^[CD][1-6]$/.test(gateMatch[1])) return false;
        }
    }

    // Rule 9 (VTBS): only show NOTAMs for gates S111-S118
    if (airport === 'VTBS') {
        const gateMatch = desc.match(/\b(?:GATE|STAND|SPOT|BAY|REMOTE)\s+(?:NR\s+)?(S\d{3})\b/);
        if (gateMatch) {
            const num = parseInt(gateMatch[1].slice(1), 10);
            if (num < 111 || num > 118) return false;
        }
    }

    // Rule 6 (KJFK): additional content exclusions
    if (airport === 'KJFK') {
        // skip LGTD AND BARRICADED construction notices (Rule 6 new)
        if (/LGTD\s+AND\s+BARRICAD/.test(desc)) return false;
        // skip MARKINGS
        if (/\bMARKINGS\b/.test(desc)) return false;
        // skip non-Terminal 1 ramp/apron notices
        if (cat === 'RAMP' || cat === 'RUNWAY LIGHT') {
            if (/TERMINAL\s+[2-9]|T[2-9]\s+RAMP/.test(desc)) return false;
        }
        // skip gates other than 5, 7, 8 (Terminal 1 gates)
        // §2: GATE/STAND/SPOT/BAY/REMOTE are all treated as the same concept
        const kjfkGate = desc.match(/\b(?:GATE|STAND|SPOT|BAY|REMOTE)\s+(?:NR\s+)?(\d+[A-Z]?)\b/);
        if (kjfkGate) {
            const gateNum = parseInt(kjfkGate[1], 10);
            if (![5, 7, 8].includes(gateNum)) return false;
        }
    }

    // ALTN airport filtering: skip minor lighting sign U/S entries (not closures)
    // These categories at ALTN airports are dominated by sign/light U/S which are low priority
    if (cat === 'OTHER' || cat === 'TAXIWAY LIGHT') {
        // Keep only if it involves a closure or WIP; skip pure lighting-out notices
        if (!/\bCLSD\b|\bCLOSED\b|\bWIP\b/.test(desc)) return false;
    }

    // Rule 3: GPS RAIM outage — only show if within ETD-ETA window
    if (cat === 'GPS' && /RAIM\s+OUTAGE/i.test(desc)) {
        return notamRaimInWindow(entry, flightData);
    }
    return true;
}

function notamRaimInWindow(entry, flightData) {
    // ETD / ETA as minutes-from-midnight on the same day scale
    const toMin = (hhmm) => {
        if (!hhmm) return -1;
        const [h, m] = hhmm.replace(':', '').match(/(\d{2})(\d{2})/).slice(1).map(Number);
        return h * 60 + m;
    };
    const etdMin = toMin(flightData.etd);
    const etaMin = toMin(flightData.eta) + (flightData.eta && flightData.etd && flightData.eta < flightData.etd ? 1440 : 0);
    if (etdMin < 0 || etaMin < 0) return true; // no ETD/ETA yet — show all

    // Look for time windows in the schedule line (e.g. "1248-1251")
    const timeRe = /(\d{4})-(\d{4})/g;
    const src = entry.sched + ' ' + entry.desc;
    let any = false;
    let m;
    while ((m = timeRe.exec(src)) !== null) {
        any = true;
        const start = parseInt(m[1].slice(0,2)) * 60 + parseInt(m[1].slice(2));
        const end   = parseInt(m[2].slice(0,2)) * 60 + parseInt(m[2].slice(2));
        if (start <= etaMin && end >= etdMin) return true;
    }
    return !any; // if no times found just show
}

// ── Display line builder ─────────────────────────────────────────

const NOTAM_CAT_STYLE = {
    'APPROACH':        { emoji: '🔴', type: 'hdr-red'    },
    'DEPARTURE':       { emoji: '🔴', type: 'hdr-red'    },
    'RUNWAY':          { emoji: '⚠️', type: 'hdr-yellow' },
    'RUNWAY LIGHT':    { emoji: '⚠️', type: 'hdr-yellow' },
    'TAXIWAY':         { emoji: '🚧', type: 'hdr-yellow' },
    'TAXIWAY LIGHT':   { emoji: '🚧', type: 'hdr-yellow' },
    'NAVAID':          { emoji: '📡', type: 'hdr-green'  },
    'GPS':             { emoji: '🛰️', type: 'hdr-yellow' },
    'COMPANY ADVISORY':{ emoji: '💬', type: 'hdr-green'  },
    'RAMP':            { emoji: '🏢', type: 'hdr-green'  },
    'AIRPORT':         { emoji: '🛬', type: 'hdr-green'  },
    'OBSTRUCTION':     { emoji: '⛔', type: 'hdr-red'    },
    'OTHER':           { emoji: 'ℹ️', type: 'hdr-green'  },
};

function wrapText(text, maxLen) {
    const words = text.split(' ');
    const out = [];
    let cur = '';
    for (const w of words) {
        if ((cur + ' ' + w).trim().length > maxLen) {
            if (cur) out.push(cur.trim());
            cur = w;
        } else {
            cur = (cur + ' ' + w).trim();
        }
    }
    if (cur) out.push(cur);
    return out;
}

function summarizeNotam(desc) {
    return desc.toUpperCase();
}

function buildNotamDisplayLines(entries, airport, runwayInfo) {
    if (!entries || entries.length === 0) return [];

    // Group by category, preserving PDF bullet order (no sorting)
    const catOrder = [];
    const groups = {};
    for (const e of entries) {
        if (!notamPassesRules(e, airport, flightData)) continue;
        const cat = e.cat || 'OTHER';
        if (!groups[cat]) { groups[cat] = []; catOrder.push(cat); }
        groups[cat].push(e);
    }

    // Move COMPANY ADVISORY to the front of catOrder (display at top)
    const caIdx = catOrder.indexOf('COMPANY ADVISORY');
    if (caIdx > 0) {
        catOrder.splice(caIdx, 1);
        catOrder.unshift('COMPANY ADVISORY');
    }

    const lines = [];

    // COMPANY ADVISORY at the very top (before RWY INFO)
    if (groups['COMPANY ADVISORY']) {
        const style = NOTAM_CAT_STYLE['COMPANY ADVISORY'];
        lines.push({ type: style.type, text: `${style.emoji}  COMPANY ADVISORY` });
        for (const e of groups['COMPANY ADVISORY']) {
            const fmtDate = (dt) => {
                if (!dt) return '';
                const m = dt.match(/(\d{2}[A-Z]{3}\d{2})/i);
                return m ? m[1].toUpperCase() : dt.split(' ')[0];
            };
            const badgeParts = [];
            if (e.dateStart) {
                const ds = fmtDate(e.dateStart);
                const de = e.dateEnd === 'UFN' ? 'UFN' : fmtDate(e.dateEnd);
                badgeParts.push(de && de !== ds ? `${ds}~${de}` : ds);
            }
            if (e.sched) badgeParts.push(e.sched);
            const dateBadge = badgeParts.length ? `(${badgeParts.join(', ')})` : '';
            const desc = summarizeNotam(e.desc);
            lines.push({ type: 'body', text: `  <u>${e.id}</u>${dateBadge ? ' ' + dateBadge : ''}` });
            wrapText('    ' + desc, 74).forEach(ln => lines.push({ type: 'body', text: ln }));
            lines.push({ type: 'blank', text: '' });
        }
    }

    // Rule 1: runway length/width info at top, 1 runway per line
    const rwList = Array.isArray(runwayInfo) ? runwayInfo : (runwayInfo ? [runwayInfo] : []);
    if (rwList.length > 0) {
        lines.push({ type: 'hdr-green', text: '📏  RWY INFO' });
        rwList.forEach(rw => lines.push({ type: 'body', text: '  ' + rw }));
        lines.push({ type: 'blank', text: '' });
    }

    for (const cat of catOrder) {
        if (cat === 'COMPANY ADVISORY') continue; // already rendered at top
        const style = NOTAM_CAT_STYLE[cat] || { emoji: 'ℹ️', type: 'hdr-green' };
        lines.push({ type: style.type, text: `${style.emoji}  ${cat}` });

        for (const e of groups[cat]) {
            const hl = (cat === 'APPROACH' || cat === 'APPROACH LIGHT' || cat === 'GPS');
            const lineType = hl ? 'body-hl' : 'body';

            // Format date as DDMONYR (e.g. "29MAY26")
            const fmtDate = (dt) => {
                if (!dt) return '';
                const m = dt.match(/(\d{2}[A-Z]{3}\d{2})/i);
                return m ? m[1].toUpperCase() : dt.split(' ')[0];
            };
            // Build compact date badge: "(DDMONYR~DDMONYR)" or "(UFN)" or "(DDMONYR~UFN)"
            // Schedule (D) time window, if present, goes inside the same parentheses.
            const badgeParts = [];
            if (e.dateStart) {
                const ds = fmtDate(e.dateStart);
                const de = e.dateEnd === 'UFN' ? 'UFN' : fmtDate(e.dateEnd);
                badgeParts.push(de && de !== ds ? `${ds}~${de}` : ds);
            }
            // GPS RAIM schedules list per-day time windows
            // ("06  1116-1119  1215-1217, 07  1112-1115 ..."). These are too long for
            // the date badge — render each day on its own line below the description.
            const isRaimSched = cat === 'GPS' && e.sched && /\d{4}-\d{4}/.test(e.sched);
            if (e.sched && !isRaimSched) badgeParts.push(e.sched);
            const dateBadge = badgeParts.length ? `(${badgeParts.join(', ')})` : '';

            // Line 1: ID + date badge
            // Line 2+: description (full uppercase, wrapped)
            const desc = summarizeNotam(e.desc);
            lines.push({ type: lineType, text: `  <u>${e.id}</u>${dateBadge ? ' ' + dateBadge : ''}` });
            wrapText('    ' + desc, 74).forEach(ln => lines.push({ type: lineType, text: ln }));

            // RAIM per-day time windows, one day per line
            if (isRaimSched) {
                e.sched.split(',').map(s => s.trim()).filter(Boolean).forEach(grp => {
                    const dm = grp.match(/^(\d{1,2})\s+(.*)$/);
                    const txt = dm ? `${dm[1].padStart(2, '0')}  ${dm[2].replace(/\s+/g, '  ')}`
                                   : grp.replace(/\s+/g, '  ');
                    lines.push({ type: lineType, text: '      ' + txt });
                });
            }

            lines.push({ type: 'blank', text: '' });
        }
    }
    return lines;
}

function buildEtpNotamDisplayLines() {
    const sections = flightData.etpNotamSections;
    if (!sections || sections.length === 0) return [];

    const lines = [];
    for (const section of sections) {
        // Big title line: ✈️  [ETP] RJCC / CTS / Sapporo New Chitose Airport
        lines.push({ type: 'etp-title', text: `✈️  ${section.title}` });
        lines.push({ type: 'blank', text: '' });

        // NOTAM entries for this ETP airport — reuse existing NOTAM display builder.
        // Extract ICAO from title: "[ETP] RJCC / CTS / ..." → "RJCC"
        const icaoMatch = section.title.match(/\[ETP\]\s*([A-Z]{4})\b/i);
        const airport = icaoMatch ? icaoMatch[1].toUpperCase() : '';
        const notamLines = buildNotamDisplayLines(section.entries, airport, []);
        lines.push(...notamLines);

        // Blank separator between airports
        lines.push({ type: 'blank', text: '' });
    }
    return lines;
}

function recalculateWeights() {
    const zfw = num(flightData.zfw);
    const fob = num(flightData.fob);
    const taxi = num(flightData.taxi);
    const trip = num(flightData.trip);
    
    flightData.tow = (zfw + fob - taxi).toFixed(1);
    flightData.lw = (zfw + fob - taxi - trip).toFixed(1);
    flightData.fod = (fob - taxi - trip).toFixed(1);
}

function updateDebugPanel() {
    const debugContent = document.getElementById('pdf-debug-content');
    if (!debugContent) return;
    
    if (!lastImportedPdfData) {
        debugContent.innerHTML = `<div class="debug-placeholder">No PDF imported yet.<br>Click IMPORT on the FMS screen.</div>`;
        return;
    }
    
    const fields = [
        { label: 'FLT NBR', key: 'fltNbr' },
        { label: 'FROM', key: 'from' },
        { label: 'TO', key: 'to' },
        { label: 'ALTN', key: 'altn' },
        { label: 'CRZ FL', key: 'crzFl' },
        { label: 'CRZ TEMP', key: 'crzTemp' },
        { label: 'CI', key: 'ci' },
        { label: 'TRIP WIND', key: 'tripWind' },
        { label: 'APMS', key: 'apms' },
        { label: 'ZFW', key: 'zfw' },
        { label: 'ZFWCG', key: 'zfwcg' },
        { label: 'FOB', key: 'fob' },
        { label: 'TAXI', key: 'taxi' },
        { label: 'PAX NBR', key: 'paxNbr' },
        { label: 'TRIP FUEL', key: 'trip' },
        { label: 'TRIP TIME', key: 'tripTime' },
        { label: 'ALTN FUEL', key: 'altnFuel' },
        { label: 'ALTN TIME', key: 'altnTime' },
        { label: 'FINAL FUEL', key: 'final' },
        { label: 'FINAL TIME', key: 'finalTime' },
        { label: 'TOW', key: 'tow' },
        { label: 'LW', key: 'lw' },
        { label: 'FOD (DEST)', key: 'fod' }
    ];
    
    let html = `
        <table class="debug-table">
            <thead>
                <tr>
                    <th style="width: 38%; text-align: left;">FIELD</th>
                    <th style="width: 31%; text-align: center;">PDF</th>
                    <th style="width: 31%; text-align: center;">ACTIVE</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    fields.forEach(f => {
        const pdfVal = lastImportedPdfData[f.key] !== undefined ? lastImportedPdfData[f.key] : '-';
        let activeVal = flightData[f.key] !== undefined ? flightData[f.key] : '-';
        
        const isMismatch = String(pdfVal).trim() !== String(activeVal).trim();
        const rowClass = isMismatch ? 'class="debug-mismatch"' : '';
        
        html += `
            <tr ${rowClass}>
                <td class="debug-field-name">${f.label}</td>
                <td class="debug-pdf-val">${pdfVal}</td>
                <td class="debug-active-val">${activeVal}</td>
            </tr>
        `;
    });
    
    html += `
            </tbody>
        </table>
    `;
    
    debugContent.innerHTML = html;
}
// --- Route Summary Data ---
let routeScrollIndex = 0;
let routeData = [];
let altnRouteData = [];
let lolvEtpData = [];
let eraValidationData = [];
let refileFltPlanData = null;
let atsFplCompareResult = null;
let activeRteSummaryTab = 'PRIMARY'; // 'PRIMARY' | 'ALTERNATE'
let altnRteScrollIndex = 0;

// ── MEMO (NOTEPAD / DRAWPAD) — 기기별 localStorage 저장, 멀티페이지 ─────────
let activeMemoTab = 'NOTEPAD'; // 'NOTEPAD' | 'DRAWPAD'
let memoNotepadPages = (() => {
    try { return JSON.parse(localStorage.getItem('ckpt_memo_notepad_pages')) || ['']; }
    catch { return ['']; }
})();
let memoNotepadPageIndex = 0;
let memoDrawpadPages = (() => {
    try { return JSON.parse(localStorage.getItem('ckpt_memo_drawpad_pages')) || [null]; }
    catch { return [null]; }
})();
let memoDrawpadPageIndex = 0;
let memoDrawColor = '#888888';
let memoDrawSize = 3;
let memoIsErasing = false;

// --- Step Altitude Transition Data ---
const stepAltData = [
    { wpt: '--------', alt: '---', dist: '', time: '' },
    { wpt: '--------', alt: '---', dist: '', time: '' }
];
let stepAltScrollIndex = 0;

// --- MEL/CDL Data ---
let melCdlScrollIndex = 0;
let activeMelCdlTab = 'MEL'; // 'MEL' or 'CREW'
let melCdlData = [];

// --- Weather Data ---
let depArrWxScrollIndex = 0;
let activeDepArrWxTab = 'DEP'; // 'DEP' or 'ARR'

// --- NOTAM Page Data ---
let depArrNotamScrollIndex = 0;
let activeDepArrNotamTab = 'DEP'; // 'DEP' or 'ARR'

let enrteNotamScrollIndex = 0;
let activeEnrteNotamTab = 'ALTN'; // 'ALTN' or 'ERA'
let activeEraFirNotamTab = 'ERA'; // 'ERA' or 'FIR'
let eraFirNotamScrollIndex = 0;
const depArrWxData = [
    { type: 'DEP', num: 'KLAX', desc: '102120Z 26012KT 10SM FEW020 21/14 A2992' },
    { type: 'ARR', num: 'RKSI', desc: '102200Z 23008KT 9999 FEW030 18/12 Q1013' },
    { type: 'ALTN', num: 'RKSS', desc: '102200Z 21006KT 9999 FEW030 19/12 Q1013' }
];

const klaxTafData = [
    { text: 'TAF KLAX 081142Z 0812/0918 VRB03KT P6SM OVC025', highlight: false },
    { text: 'FM081700 25008KT P6SM FEW015 BKN025', highlight: true },
    { text: 'FM082000 25015KT P6SM FEW015 SCT250', highlight: false },
    { text: 'FM090400 26008KT P6SM BKN025', highlight: false },
    { text: 'FM090800 VRB03KT P6SM BKN015', highlight: false }
];

const rksiTafData = [
    { text: 'TAF RKSI 081100Z 0812/0918 29015G25KT CAVOK TN16/0821Z TX25/0906Z', highlight: false },
    { text: 'BECMG 0813/0815 32006KT 6000 NSC', highlight: false },
    { text: 'BECMG 0900/0902 24008KT CAVOK', highlight: true },
    { text: 'BECMG 0913/0915 34006KT', highlight: false },
    { text: 'BECMG 0916/0918 15006KT', highlight: false }
];

let enrteWxScrollIndex = 0;
let activeEnrteWxTab = 'ALTN'; // 'ALTN' or 'ERA'
const alternateWxData = [
    { text: 'TAF RKSS 081100Z 0812/0918 30005KT CAVOK TN14/0820Z TX28/0906Z', highlight: false },
    { text: 'BECMG 0815/0817 06005KT', highlight: false },
    { text: 'BECMG 0901/0903 26007KT', highlight: true },
    { text: 'BECMG 0913/0915 20005KT 6000 SCT040', highlight: false },
    { text: 'TAF KSFO 081120Z 0812/0918 27011KT P6SM FEW015 SCT200', highlight: true },
    { text: 'FM081700 28015KT P6SM SCT050', highlight: true },
    { text: 'FM082000 27020G30KT P6SM SCT050', highlight: true },
    { text: 'FM090300 27015KT P6SM BKN015 OVC050', highlight: false },
    { text: 'FM091700 28007KT P6SM BKN050', highlight: false },
    { text: 'TAF PACD 081132Z 0812/0912 30011KT P6SM OVC005', highlight: true },
    { text: 'FM082000 30010KT P6SM SCT005', highlight: true },
    { text: 'FM090600 32007KT P6SM BKN005', highlight: false },
    { text: 'TAF RJAA 081105Z 0812/0918 14004KT 6000 -SHRA FEW003 BKN012', highlight: false },
    { text: 'TEMPO 0812/0814 FEW003 BKN005', highlight: false },
    { text: 'TEMPO 0814/0823 2000 -SHRA BR FEW001 BKN003', highlight: false },
    { text: 'BECMG 0818/0820 36006KT', highlight: false },
    { text: 'TEMPO 0823/0903 FEW003 BKN005', highlight: true },
    { text: 'BECMG 0903/0906 13008KT', highlight: true },
    { text: 'BECMG 0909/0912 04006KT', highlight: false },
    { text: 'TAF RJBB 081105Z 0812/0918 36010KT 6000 -SHRA FEW005 SCT010 BKN015', highlight: true },
    { text: 'TEMPO 0812/0816 3000 SHRA BR FEW002 SCT004 BKN008', highlight: false }
];

const enrouteWxDataList = [
    { text: 'TAF KLAX 081142Z 0812/0918 VRB03KT P6SM OVC025', highlight: true },
    { text: 'FM081700 25008KT P6SM FEW015 BKN025', highlight: true },
    { text: 'FM082000 25015KT P6SM FEW015 SCT250', highlight: true },
    { text: 'FM090400 26008KT P6SM BKN025', highlight: false },
    { text: 'FM090800 VRB03KT P6SM BKN015', highlight: false },
    { text: 'TAF KSFO 081120Z 0812/0918 27011KT P6SM FEW015 SCT200', highlight: true },
    { text: 'FM081700 28015KT P6SM SCT050', highlight: true },
    { text: 'FM082000 27020G30KT P6SM SCT050', highlight: true },
    { text: 'FM090300 27015KT P6SM BKN015 OVC050', highlight: false },
    { text: 'FM091700 28007KT P6SM BKN050', highlight: false },
    { text: 'TAF KSEA 081140Z 0812/0918 15004KT P6SM BKN100 OVC130', highlight: true },
    { text: 'FM082100 26008KT P6SM VCSH BKN050 OVC100', highlight: true },
    { text: 'FM082300 35007KT 6SM -RA BR OVC035', highlight: false },
    { text: 'FM090200 11010KT 6SM -RA BR OVC025', highlight: false },
    { text: 'FM090500 18010KT 5SM -RA BR OVC015', highlight: false },
    { text: 'FM090900 20012G22KT 5SM -RA BR OVC015', highlight: false },
    { text: 'TAF CYVR 081144Z 0812/0918 08008KT P6SM SCT060 OVC100', highlight: true },
    { text: 'TEMPO 0812/0821 P6SM -SHRA BKN040 OVC080', highlight: true },
    { text: 'BECMG 0812/0814 11008KT', highlight: false },
    { text: 'FM082100 14008KT P6SM -RA SCT030 OVC050', highlight: true },
    { text: 'TEMPO 0821/0905 3SM RA BR BKN020', highlight: true },
    { text: 'BECMG 0900/0902 VRB03KT', highlight: false },
    { text: 'FM090500 VRB03KT P6SM -RA SCT006 OVC025', highlight: false },
    { text: 'TEMPO 0905/0915 2SM RA BR SCT005 OVC015', highlight: false },
    { text: 'BECMG 0907/0909 30008KT', highlight: false },
    { text: 'FM091500 26010KT P6SM SCT020 BKN040', highlight: false },
    { text: 'TEMPO 0915/0918 5SM -SHRA BR BKN020', highlight: false },
    { text: 'BECMG 0916/0918 19008KT RMK NXT FCST BY 081500Z', highlight: false },
    { text: 'TAF PACD 081132Z 0812/0912 30011KT P6SM OVC005', highlight: true },
    { text: 'FM082000 30010KT P6SM SCT005', highlight: true },
    { text: 'FM090600 32007KT P6SM BKN005', highlight: false },
    { text: 'TAF RJAA 081105Z 0812/0918 14004KT 6000 -SHRA FEW003 BKN012', highlight: false },
    { text: 'TEMPO 0812/0814 FEW003 BKN005', highlight: false },
    { text: 'TEMPO 0814/0823 2000 -SHRA BR FEW001 BKN003', highlight: false },
    { text: 'BECMG 0818/0820 36006KT', highlight: false },
    { text: 'TEMPO 0823/0903 FEW003 BKN005', highlight: true },
    { text: 'BECMG 0903/0906 13008KT', highlight: true },
    { text: 'BECMG 0909/0912 04006KT', highlight: false },
    { text: 'TAF RJBB 081105Z 0812/0918 36010KT 6000 -SHRA FEW005 SCT010 BKN015', highlight: true },
    { text: 'TEMPO 0812/0816 3000 SHRA BR FEW002 SCT004 BKN008', highlight: false },
    { text: 'TAF RJTT 081105Z 0812/0918 12006KT 9999 FEW015 BKN030', highlight: false },
    { text: 'BECMG 0812/0814 19012KT', highlight: false },
    { text: 'TEMPO 0815/0818 FEW005 BKN008', highlight: false },
    { text: 'BECMG 0817/0819 30006KT', highlight: false },
    { text: 'TEMPO 0818/0822 3000 -SHRA BR FEW005 BKN008', highlight: false },
    { text: 'BECMG 0900/0903 09006KT', highlight: true },
    { text: 'BECMG 0903/0906 17012KT', highlight: true },
    { text: 'BECMG 0912/0915 30006KT', highlight: false },
    { text: 'BECMG 0915/0918 36012KT', highlight: false },
    { text: 'TAF RJCC 081105Z 0812/0918 33006KT 8000 -SHRA FEW005 BKN012', highlight: false },
    { text: 'TEMPO 0812/0815 1500 SHRA BR FEW001 BKN003', highlight: false },
    { text: 'TEMPO 0815/0818 3000 SHRA BR FEW003 BKN005', highlight: false },
    { text: 'TEMPO 0818/0900 4000 -SHRA BR FEW003 BKN005', highlight: true },
    { text: 'BECMG 0821/0823 17010KT', highlight: false },
    { text: 'BECMG 0900/0903 33016KT', highlight: true },
    { text: 'TEMPO 0912/0918 33018G30KT', highlight: false },
    { text: 'TAF RKSI 081100Z 0812/0918 29015G25KT CAVOK TN16/0821Z TX25/0906Z', highlight: false },
    { text: 'BECMG 0813/0815 32006KT 6000 NSC', highlight: false },
    { text: 'BECMG 0900/0902 24008KT CAVOK', highlight: true },
    { text: 'BECMG 0913/0915 34006KT', highlight: false },
    { text: 'BECMG 0916/0918 15006KT', highlight: false },
    { text: 'TAF RKPC 081100Z 0812/0918 27005KT 9999 FEW015 BKN170 TN16/0820Z TX25/0905Z', highlight: false },
    { text: 'BECMG 0813/0815 18005KT CAVOK', highlight: false },
    { text: 'BECMG 0823/0901 06009KT', highlight: true },
    { text: 'BECMG 0910/0912 21005KT', highlight: false }
];


// --- DOM Elements ---
const mainContent = document.getElementById('fms-main-content');
const pageTitleText = document.getElementById('page-title-text');
const btnInit = document.getElementById('btn-init');

// --- Helper Functions ---
function updateHeaderFltNbr() {
    const headerRight = document.querySelector('.header-right');
    if (headerRight) {
        headerRight.textContent = flightData.fltNbr;
    }
}

function getFuelTableHTML() {
    return `
        <!-- Dynamic Destination Table styled exactly like A350/A380 FMS photo -->
        <div class="fms-fuel-table">
            <div class="fuel-table-row header">
                <div></div>
                <div class="text-white-fms" style="text-align: center;">UTC</div>
                <div class="text-white-fms" style="text-align: center;">EFOB</div>
                <div class="text-white-fms" style="display: inline-block;">MIN FUEL AT DEST</div>
            </div>
            
            <div class="fuel-table-row">
                <div class="text-white-fms">DEST <span class="text-green-fms">${flightData.to}</span></div>
                <div class="text-green-fms" style="text-align: center;" id="dest-utc-val">${destUtc}</div>
                <div id="dest-efob-val" class="text-green-fms" style="text-align: center;">${getDestEfob()}</div>
                <div>
                    <div id="dest-min-fuel-val" class="dest-min-fuel-box">${getDestMinFuel()}</div>
                </div>
            </div>

            <div class="fuel-table-row">
                <div class="text-white-fms">ALTN <span class="text-green-fms">${flightData.altn}</span></div>
                <div class="text-green-fms" style="text-align: center;" id="altn-utc-val">${getAltnUtc()}</div>
                <div id="altn-efob-val" class="text-cyan-fms" style="text-align: center;">${getAltnEfob()}</div>
                <div></div>
            </div>

            <div class="divider-line"></div>

            <!-- EXTRA Row mapped to align elements directly under the 11.0 box -->
            <div class="fuel-table-row fuel-table-extra-row">
                <div class="dispatch-notes-col" style="width: 280px; text-align: left; line-height: 1.2;">
                    <div style="font-size: 0.85rem; color: var(--text-white); font-weight: bold; margin-bottom: 2px;">DISPATCH NOTES</div>
                    <div style="font-size: 0.85rem; font-weight: bold;">
                        <span class="text-green-fms">CCF : ${flightData.ccf || '0'} LBS</span> in DISC FUEL<br>
                        <span style="font-size: 0.75rem; color: var(--text-gray);">(DUE TO ENROUTE CB/TS, TURB)</span><br>
                        <span class="text-green-fms">TANKRG : ${flightData.tank || '0'} LBS</span>
                    </div>
                    ${flightData.fuelStatMean ? `
                    <div style="font-size: 0.78rem; font-weight: bold; margin-top: 4px;">
                        <span style="color: var(--text-white);">ROUTE FUEL CONSUMPTION STATISTICS</span><br>
                        <span class="text-green-fms">MEAN/95%/99% = ${flightData.fuelStatMean}/${flightData.fuelStat95}/${flightData.fuelStat99} (LBS)</span>
                    </div>` : ''}
                </div>
                <div style="width: 0 !important; margin: 0; padding: 0;"></div>
                <div style="width: 0 !important; margin: 0; padding: 0;"></div>
                <div class="extra-value-container">
                    <div class="extra-label-sub">EXTRA</div>
                    <div class="extra-sub-headers" style="width: 140px;">
                        <span>FUEL</span>
                        <span>TIME</span>
                    </div>
                    <div class="extra-inner">
                        <span id="extra-fuel-val" class="text-green-fms">${getExtraFuel()}</span>
                        <span class="text-green-fms">${extraTime}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function resetTitleBar() {
    const titleBar = document.querySelector('.page-title-bar');
    if (titleBar) {
        titleBar.style.backgroundColor = '#ffffff';
        titleBar.style.color = '#000000';
        titleBar.style.borderBottom = 'none';
    }
}

// --- Page Renderers ---
function renderInitPage() {
    resetTitleBar();
    pageTitleText.textContent = 'ACTIVE/INIT';
    btnInit.classList.add('active');
    
    mainContent.innerHTML = `
        <!-- Row 1: FLT NBR & ACFT STATUS -->
        <div class="fms-row row-flt-nbr">
            <div class="fms-cell" style="justify-content: space-between;">
                <div class="cell-left" style="gap: 6px;">
                    <span class="fms-label">FLT NBR</span>
                    <div class="fms-val-box extracted-value flt-nbr-box">
                        <input type="text" value="${flightData.fltNbr}" id="input-flt-nbr" style="width: 100%;">
                    </div>
                </div>
                <div class="cell-left" style="gap: 6px; margin-left: 0px;">
                    <span class="fms-label" style="width: 32px; margin-right: 0px;">ACFT</span>
                    <div class="fms-val-box extracted-value acft-box">
                        <input type="text" value="${flightData.acftReg}" data-field="acftReg" style="width: 100%;">
                    </div>
                </div>
                <div class="cell-right" style="gap: 6px;">
                    <button class="fms-btn-grey acft-status-btn" style="border-color: var(--text-green); color: var(--text-green);">APMS ${flightData.apms.replace(' %', '')}</button>
                    <label for="pdf-file-input" class="fms-btn-grey cpny-request-btn" style="border-color: var(--text-cyan); color: var(--text-cyan); font-size: 0.9rem; font-weight: bold; display: flex; justify-content: center; align-items: center; cursor: pointer; box-sizing: border-box;">IMPORT</label>
                </div>
            </div>
        </div>

        <!-- Row 2: FROM TO ALTN + GATE -->
        <div class="fms-row">
            <div class="fms-cell" style="justify-content: flex-start; gap: 8px; flex-wrap: wrap;">
                <span class="fms-label">FROM</span>
                <div class="fms-val-box extracted-value airport-box">
                    <input type="text" value="${flightData.from}" data-field="from">
                </div>
                <span style="color: var(--text-white); font-weight: 700; font-size: 0.8rem; margin: 0 4px;">TO</span>
                <div class="fms-val-box extracted-value airport-box">
                    <input type="text" value="${flightData.to}" data-field="to">
                </div>
                <span style="color: var(--text-white); font-weight: 700; font-size: 0.8rem; margin: 0 4px;">ALTN</span>
                <div class="fms-val-box extracted-value altn-airport-box">
                    <input type="text" value="${flightData.altn}" data-field="altn">
                </div>
                <span style="color: var(--text-white); font-weight: 700; font-size: 0.8rem; margin: 0 4px 0 8px;">GATE</span>
                <span id="dep-gate-display"
                      onclick="fetchGate();"
                      title="탭하면 게이트 재조회"
                      style="color:${flightData.depGate ? 'var(--text-cyan)' : '#666'};
                             font-family:'Share Tech Mono',monospace; font-size:0.8rem;
                             cursor:pointer; min-width:60px;">
                    ${buildGateLabel()}
                </span>
            </div>
        </div>

        <!-- Row 3: CPNY RTE -->
        <div class="fms-row">
            <div class="fms-cell" style="justify-content: flex-start; gap: 10px;">
                <span class="fms-label">CPNY RTE</span>
                <div class="fms-val-box white-text route-box">
                    <input type="text" value="${flightData.cponyRte}" data-field="cponyRte">
                </div>
                <button class="fms-btn-grey route-sel-btn">RTE SEL</button>
            </div>
        </div>
        
        <!-- Row 4: ALTN RTE -->
        <div class="fms-row">
            <div class="fms-cell" style="justify-content: flex-start; gap: 10px;">
                <span class="fms-label">ALTN RTE</span>
                <div class="fms-val-box cyan-text route-box">
                    <input type="text" value="${flightData.altnRte}" data-field="altnRte">
                </div>
                <button class="fms-btn-grey route-sel-btn" style="color: #cbd5e0;">ALTN RTE SEL</button>
            </div>
        </div>

        <div class="divider-line"></div>

        <!-- Row 5: CRZ FL & CRZ TEMP -->
        <div class="fms-row">
            <div class="fms-cell" style="justify-content: space-between;">
                <div class="cell-left" style="gap: 6px;">
                    <span class="fms-label">CRZ FL</span>
                    <div class="fms-val-box extracted-value" style="width: 100px;">
                        <input type="text" value="${flightData.crzFl}" data-field="crzFl">
                    </div>
                </div>
                <div class="cell-right" style="gap: 6px;">
                    <span class="fms-label label-right" style="width: 80px; text-align: right;">CRZ TEMP</span>
                    <div class="fms-val-box extracted-value" style="width: 100px;">
                        <input type="text" value="${flightData.crzTemp}" data-field="crzTemp">
                    </div>
                </div>
            </div>
        </div>

        <!-- Row 6: MODE & TROPO -->
        <div class="fms-row">
            <div class="fms-cell" style="justify-content: space-between;">
                <div class="cell-left" style="gap: 6px;">
                    <span class="fms-label">MODE</span>
                    <div class="fms-val-box white-text" style="width: 135px; justify-content: space-between;">
                        <span>${flightData.mode}</span><span class="arrow-down">▼</span>
                    </div>
                </div>
                <div class="cell-right" style="gap: 6px;">
                    <span class="fms-label label-right" style="width: 80px; text-align: right;">TROPO</span>
                    <div class="fms-val-box cyan-text" style="width: 110px;">
                        <input type="text" value="${flightData.tropo}" data-field="tropo">
                    </div>
                </div>
            </div>
        </div>

        <!-- Row 7: CI -->
        <div class="fms-row">
            <div class="fms-cell" style="justify-content: space-between;">
                <div class="cell-left" style="gap: 6px;">
                    <span class="fms-label">CI</span>
                    <div class="fms-val-box extracted-value" style="width: 72px;">
                        <input type="text" value="${flightData.ci}" data-field="ci">
                    </div>
                </div>
                <div class="cell-right">
                    <button class="fms-btn-grey" style="width: 130px;">CPNY WIND<br>REQUEST</button>
                </div>
            </div>
        </div>

        <!-- Row 8: TRIP WIND & WIND -->
        <div class="fms-row">
            <div class="fms-cell" style="justify-content: flex-start; gap: 8px;">
                <span class="fms-label">TRIP WIND</span>
                <div class="fms-val-box extracted-value" style="width: 100px;" id="ref-wind-box">
                    <input type="text" value="${flightData.tripWind}" data-field="tripWind">
                </div>
                <button class="fms-btn-grey" style="width: 76px;">WIND</button>
            </div>
        </div>

        <div class="divider-line"></div>

        <!-- FMS Bottom Action Menus -->
        <div class="fms-bottom-layout">
            <div class="bottom-aligned-row">
                <button class="fms-btn-grey align-target-btn btn-mel-cdl-trigger" style="border-color: #ffffff; color: #ffffff;">MEL/CDL</button>
                <button class="fms-btn-grey align-target-btn rte-summary-aligned-btn" style="border-color: #ffffff; color: #ffffff;">RTE SUMMARY</button>
            </div>
            <div class="bottom-aligned-row">
                <button class="fms-btn-grey align-target-btn btn-dep-arr-wx-trigger" style="border-color: #ffffff; color: #ffffff;">DEP/ARR WX</button>
                <button class="fms-btn-grey align-target-btn btn-dep-arr-notam-trigger" style="border-color: #ffffff; color: #ffffff;">DEP/ARR NOTAM</button>
            </div>
            <div class="bottom-aligned-row">
                <button class="fms-btn-grey align-target-btn btn-enrte-wx-trigger" style="border-color: #ffffff; color: #ffffff;">ENRTE WX</button>
                <button class="fms-btn-grey align-target-btn btn-enrte-notam-trigger" style="border-color: #ffffff; color: #ffffff;">ALTN NOTAM</button>
            </div>
            <div class="bottom-aligned-row">
                <button class="fms-btn-grey align-target-btn btn-fuel-load-trigger" style="border-color: #ffffff; color: #ffffff;">FUEL&LOAD</button>
                <button class="fms-btn-grey align-target-btn btn-era-fir-notam-trigger" style="border-color: #ffffff; color: #ffffff;">ERA/FIR NOTAM</button>
            </div>
            <div class="bottom-aligned-row">
                <button class="fms-btn-grey align-target-btn btn-step-alts-trigger" style="border-color: #ffffff; color: #ffffff;">STEP ALT</button>
                <button class="fms-btn-grey align-target-btn btn-crew-briefing-trigger" style="border-color: #ffffff; color: #ffffff; font-size: 0.7rem;">CREW/CABIN<br>BRIEFING</button>
            </div>
        </div>
    `;

    updateHeaderFltNbr();
    
    const inputFltNbr = document.getElementById('input-flt-nbr');
    if (inputFltNbr) {
        inputFltNbr.addEventListener('input', (e) => {
            flightData.fltNbr = e.target.value;
            updateHeaderFltNbr();
        });
    }
}

function getRteSummaryTableHTML() {
    let html = '';
    for (let i = 0; i < 13; i++) {
        const rowIndex = routeScrollIndex + i;
        const pair1 = routeData[rowIndex * 2];
        const pair2 = routeData[rowIndex * 2 + 1];
        
        const airway1 = pair1 ? pair1.airway : '';
        const wp1 = pair1 ? pair1.waypoint : '';
        const airway2 = pair2 ? pair2.airway : '';
        const wp2 = pair2 ? pair2.waypoint : '';
        
        html += `
            <tr>
                <td class="text-white-fms" style="width: 22%;">${airway1}</td>
                <td class="text-green-fms" style="width: 25%;">${wp1}</td>
                <td class="text-white-fms" style="width: 25%;">${airway2}</td>
                <td class="text-green-fms" style="width: 28%;">${wp2}</td>
            </tr>
        `;
    }
    return html;
}

function updateRteTableOnly() {
    const tbody = document.querySelector('.rte-summary-table tbody');
    if (tbody) {
        tbody.innerHTML = activeRteSummaryTab === 'PRIMARY' ? getRteSummaryTableHTML() : getAltnRteSummaryTableHTML();
    }
}

// ALTERNATE RTEs 페이지의 모든 섹션(루트/LOLV/ERA/REFILE)을 하나의 행 목록으로 합쳐서
// PRIMARY RTEs와 동일하게 ▼▼/▲▲ 버튼으로 13행씩 페이지 단위 이동(스크롤 없음)을 구현
function buildAltnRteRows() {
    const rows = [];
    for (let i = 0; i < Math.ceil(altnRouteData.length / 2); i++) {
        const pair1 = altnRouteData[i * 2];
        const pair2 = altnRouteData[i * 2 + 1];
        if (!pair1 && !pair2) continue; // 빈 행은 건너뛰어 불필요한 여백 방지
        rows.push({ type: 'route-pair', pair1, pair2 });
    }
    if (lolvEtpData.length) {
        rows.push({ type: 'spacer-2' });
        rows.push({ type: 'header', text: 'LOLV EQUAL TIME POINT DATA' });
        lolvEtpData.forEach(p => rows.push({ type: 'lolv', data: p }));
        rows.push({ type: 'spacer' });
    }
    if (eraValidationData.length) {
        rows.push({ type: 'header', text: '3% CONTINGENCY ERA VALIDATION' });
        eraValidationData.forEach(d => rows.push({ type: 'era', data: d }));
        rows.push({ type: 'spacer' });
    }
    if (refileFltPlanData) {
        rows.push({ type: 'header', text: `REFILE FLT PLAN ${refileFltPlanData.fltNbr} ${refileFltPlanData.date}` });
        refileFltPlanData.segments.forEach(s => rows.push({ type: 'refile-seg', data: s }));
        if (refileFltPlanData.plannedRf) rows.push({ type: 'refile-planned', text: refileFltPlanData.plannedRf });
        if (refileFltPlanData.rifRoute) rows.push({ type: 'refile-rif', text: refileFltPlanData.rifRoute });
    }
    return rows;
}

function getAltnRteRowHTML(row) {
    switch (row.type) {
        case 'route-pair':
            return `
                <tr>
                    <td class="text-white-fms" style="width: 22%;">${row.pair1 ? row.pair1.airway : ''}</td>
                    <td class="text-green-fms" style="width: 25%;">${row.pair1 ? row.pair1.waypoint : ''}</td>
                    <td class="text-white-fms" style="width: 25%;">${row.pair2 ? row.pair2.airway : ''}</td>
                    <td class="text-green-fms" style="width: 28%;">${row.pair2 ? row.pair2.waypoint : ''}</td>
                </tr>
            `;
        case 'header':
            return `<tr style="height:24px;"><td colspan="4" style="font-size:0.68rem; color:var(--text-cyan); font-weight:bold;">${row.text}</td></tr>`;
        case 'spacer':
            return `<tr style="height:12px;"><td colspan="4"></td></tr>`;
        case 'spacer-2':
            return `<tr style="height:24px;"><td colspan="4"></td></tr>`;
        case 'lolv':
            return `
                <tr>
                    <td class="text-white-fms" style="width: 22%; font-size:0.75rem;">${row.data.from}-${row.data.to}</td>
                    <td class="text-green-fms" colspan="3" style="font-size:0.75rem; font-family:'Share Tech Mono',monospace;">
                        ETP LAT/LONG&nbsp;&nbsp;&nbsp;${row.data.lat} ${row.data.lon}
                    </td>
                </tr>
            `;
        case 'era':
            return `
                <tr>
                    <td class="text-green-fms" style="width: 22%; font-size:0.75rem;">${row.data.era}</td>
                    <td class="text-white-fms" style="width:14%; font-size:0.7rem;">COC</td>
                    <td colspan="2" class="text-green-fms" style="font-size:0.75rem; font-family:'Share Tech Mono',monospace;">${row.data.lat} ${row.data.lon}</td>
                </tr>
            `;
        case 'refile-seg':
            return `
                <tr>
                    <td class="text-white-fms" style="width: 22%; font-size:0.75rem;">${row.data.from} TO ${row.data.to}</td>
                    <td colspan="3" class="text-green-fms" style="font-size:0.75rem; font-family:'Share Tech Mono',monospace;">
                        RQRD ${row.data.rqrd} klbs
                    </td>
                </tr>
            `;
        case 'refile-planned':
            return `
                <tr>
                    <td colspan="4" class="text-green-fms" style="font-size:0.75rem; font-family:'Share Tech Mono',monospace;">
                        PLANNED R/F AT REFILE POINT ${row.text} klbs
                    </td>
                </tr>
            `;
        case 'refile-rif':
            return `
                <tr>
                    <td colspan="4" class="text-green-fms" style="font-size:0.75rem; font-family:'Share Tech Mono',monospace;">
                        RIF/ ${row.text}
                    </td>
                </tr>
            `;
        default:
            return '';
    }
}

function getAltnRteSummaryTableHTML() {
    const rows = buildAltnRteRows();
    let html = '';
    for (let i = 0; i < 13; i++) {
        const row = rows[altnRteScrollIndex + i];
        html += row ? getAltnRteRowHTML(row) : `<tr style="height:24px;"><td colspan="4"></td></tr>`;
    }
    return html;
}

function getStepAltsTableHTML() {
    let html = '';
    for (let i = 0; i < 5; i++) {
        const index = stepAltScrollIndex + i;
        const item = stepAltData[index];
        if (!item) continue;

        if (item.wpt === '--------') {
            html += `
                <div style="padding-bottom: 4px;">
                    <div class="fms-val-box" style="width: 100%; justify-content: space-between; border-color: var(--btn-border); color: var(--text-green); font-size: 0.8rem; height: 25px; padding: 0 4px; background-color: #111419;">
                        <span>--------</span><span class="arrow-down">▼</span>
                    </div>
                </div>
                <div style="border-right: 1.5px solid #2f3542; padding-right: 4px; padding-bottom: 4px;">
                    <div class="fms-val-box" style="width: 100%; border-color: var(--btn-border); color: var(--text-green); font-size: 0.8rem; height: 25px; background-color: #111419;">
                        ---
                    </div>
                </div>
                <div style="grid-column: span 2; padding-bottom: 4px;"></div>
            `;
        } else {
            const isN55E180 = item.wpt === 'N55E180';
            const wptFontSize = isN55E180 ? '0.72rem' : '0.8rem';
            const flValue = item.alt.replace('FL', '');
            
            let distVal = '';
            if (item.dist) {
                if (item.dist === '---') {
                    distVal = '---';
                } else {
                    distVal = `${item.dist.split(' ')[0]} <span style="color: var(--text-cyan); font-size: 0.7rem;">NM</span>`;
                }
            }
            const timeVal = item.time || '';
            
            html += `
                <div style="padding-bottom: 4px;">
                    <div class="fms-val-box" style="width: 100%; justify-content: space-between; border-color: var(--btn-border); color: var(--text-green); font-size: ${wptFontSize}; height: 25px; padding: 0 4px; background-color: #111419;">
                        <span>${item.wpt}</span><span class="arrow-down">▼</span>
                    </div>
                </div>
                <div style="border-right: 1.5px solid #2f3542; padding-right: 4px; padding-bottom: 4px;">
                    <div class="fms-val-box" style="width: 100%; border-color: var(--btn-border); font-size: 0.8rem; height: 25px; display: flex; gap: 4px; justify-content: center; background-color: #111419;">
                        <span style="color: var(--text-cyan);">FL</span><span style="color: var(--text-green);">${flValue}</span>
                    </div>
                </div>
                <div style="color: var(--text-green); font-weight: bold; font-size: 0.8rem; padding-left: 6px; padding-bottom: 4px;">
                    ${distVal}
                </div>
                <div style="color: var(--text-green); font-weight: bold; font-size: 0.8rem; padding-bottom: 4px;">
                    ${timeVal}
                </div>
            `;
        }
    }
    return html;
}

function updateStepAltsTableOnly() {
    const grid = document.querySelector('.step-alt-grid');
    if (grid) {
        const headerHTML = `
            <div style="font-size: 0.72rem; color: var(--text-gray); font-weight: bold; padding-bottom: 2px;">WPT</div>
            <div style="font-size: 0.72rem; color: var(--text-gray); font-weight: bold; border-right: 1.5px solid #2f3542; padding-right: 4px; padding-bottom: 2px;">ALT</div>
            <div style="font-size: 0.72rem; color: var(--text-gray); font-weight: bold; padding-left: 6px; padding-bottom: 2px;">DIST</div>
            <div style="font-size: 0.72rem; color: var(--text-gray); font-weight: bold; padding-bottom: 2px;">TIME</div>
        `;
        grid.innerHTML = headerHTML + getStepAltsTableHTML();
    }
}

function getMelCdlTableHTML() {
    let html = '';
    for (let i = 0; i < 13; i++) {
        const index = melCdlScrollIndex + i;
        const item = melCdlData[index];
        if (!item) {
            html += `
                <tr style="height: 24px;">
                    <td style="width: 15%;"></td>
                    <td style="width: 25%;"></td>
                    <td style="width: 60%;"></td>
                </tr>
            `;
            continue;
        }
        
        html += `
            <tr style="height: 24px;">
                <td class="text-white-fms" style="width: 15%;">${item.type}</td>
                <td class="text-green-fms" style="width: 25%; font-weight: bold;">${item.num}</td>
                <td class="text-green-fms" style="width: 60%;">${item.desc}</td>
            </tr>
        `;
    }
    return html;
}

function updateMelTableOnly() {
    const tbody = document.querySelector('.mel-cdl-table tbody');
    if (tbody) {
        tbody.innerHTML = getMelCdlTableHTML();
    }
}

function renderMelCdlPage() {
    resetTitleBar();
    pageTitleText.textContent = 'ACTIVE/MEL/CDL';
    btnInit.classList.remove('active');

    const isMelTab = activeMelCdlTab === 'MEL';

    mainContent.innerHTML = `
        <!-- Folder Tabs -->
        <div class="fms-tabs" style="margin-bottom: 6px;">
            <div class="fms-tab ${isMelTab ? 'active' : ''}" id="tab-mel-active">ACTIVE MEL/CDL</div>
            <div class="fms-tab ${!isMelTab ? 'active' : ''}" id="tab-crew-defer">CREW DEFER</div>
        </div>

        ${isMelTab ? `
            <!-- Row 1: ACFT IDENT & Page Number & Navigation -->
            <div class="fms-row" style="margin-bottom: 2px;">
                <div class="fms-cell" style="justify-content: space-between; align-items: center; width: 100%;">
                    <div class="cell-left" style="gap: 10px; align-items: center;">
                        <span class="fms-label" style="width: auto; margin-right: 0;">ACFT IDENT</span>
                        <div class="fms-val-box cyan-text" style="width: 140px; justify-content: space-between;">
                            <span>HL7640</span><span class="arrow-down">▼</span>
                        </div>
                    </div>
                    <div class="cell-right" style="gap: 12px; align-items: center;">
                        <span class="text-white-fms" style="font-size: 0.85rem;">1/1</span>
                        <div style="display: flex; gap: 4px;">
                            <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">◀◀</button>
                            <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▶▶</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Row 2: STATUS ITEMS -->
            <div class="fms-row" style="margin-bottom: 4px;">
                <div class="fms-cell" style="justify-content: flex-start; gap: 8px; font-size: 0.9rem;">
                    <span class="text-white-fms">STATUS</span>
                    <span class="text-green-fms" style="font-weight: bold; margin-right: 15px;">ACTIVE</span>
                    <span class="text-white-fms">ITEMS</span>
                    <span style="color: var(--text-green); font-weight: bold;">${melCdlData.filter(x => x.type === 'MEL').length} MEL / ${melCdlData.filter(x => x.type === 'CDL').length} CDL</span>
                </div>
            </div>

            <!-- MEL/CDL Table (13 rows) -->
            <table class="rte-summary-table mel-cdl-table" style="margin-bottom: 4px;">
                <tbody>
                    ${getMelCdlTableHTML()}
                </tbody>
            </table>

            <!-- Table Vertical Scroll Navigation -->
            <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 4px;">
                <button class="fms-btn-grey fms-btn-scroll" id="btn-mel-scroll-down" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▼▼</button>
                <button class="fms-btn-grey fms-btn-scroll" id="btn-mel-scroll-up" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▲▲</button>
            </div>
        ` : `
            <!-- Crew Defer procedure regulation contents -->
            <div class="crew-defer-container" style="border: 1.5px solid #2f3542; border-radius: 4px; padding: 10px; background-color: #12141a; font-size: 0.73rem; line-height: 1.45; text-align: left; height: 326px; overflow-y: auto; box-sizing: border-box; margin-bottom: 4px;">
                <div style="color: #ffffff; font-weight: bold; font-size: 0.8rem; border-bottom: 1.5px solid #2f3542; padding-bottom: 4px; margin-bottom: 8px;">6.1.6.4 CREW DEFER PROCEDURE</div>
                
                <div style="margin-bottom: 8px;">
                    <span style="color: #ffffff; font-weight: bold;">■ 결함 적용 시점</span><br>
                    <span class="text-green-fms">Door Close 후 ~ 이륙 추력 증가 시점 사이</span> 결함 발생 시 운항승무원이 적용하는 절차 (MEL 'After Door Close' 란에 'Crew Defer' 표기)
                </div>
                
                <div style="margin-bottom: 8px;">
                    <span style="color: #ffffff; font-weight: bold;">■ (O) Procedure 수행</span><br>
                    이륙 전에 수행하며, 'FLIGHT PLANNING RESTRICTIONS'이 있을 경우 OCC/운항관리사와 협의 운항 결정. 단 통신 불가 시 제한사항 충족 시 협의 없이 운항 가능.
                </div>
                
                <div style="margin-bottom: 8px;">
                    <span style="color: #ffffff; font-weight: bold;">■ DEFER PLACARD 부착</span><br>
                    Placard 하단의 <span class="text-green-fms">'INOPERATIVE' 탭</span>만을 떼어내어 부작동 계기, 스위치, 라이트 등의 적절한 위치에 부착.
                </div>
                
                <div style="margin-bottom: 8px; border: 1px dashed var(--text-green); padding: 4px 6px; border-radius: 3px; background-color: #161a22;">
                    <span style="color: #ffffff; font-weight: bold;">■ A380 DEFER PLACARD 보관 위치</span><br>
                    <span style="color: var(--text-cyan); font-weight: bold;">F/O Side Stowage Box</span>
                </div>
                
                <div style="margin-bottom: 8px;">
                    <span style="color: #ffffff; font-weight: bold;">■ OCC/운항관리사 통보</span><br>
                    다음 Station 조치를 위해 가용 통신망(ACARS 또는 SATCOM 등)을 통해 Defer 내용 즉시 통보.
                </div>
                
                <div>
                    <span style="color: #ffffff; font-weight: bold;">■ 비행 기록</span><br>
                    비행 및 정비일지에 결함사항과 함께 MEL에 따른 Crew Defer Procedure 수행 사실 기록.
                </div>
            </div>
        `}

        <!-- Bottom Actions Row -->
        <div class="fms-row" style="margin-top: auto; padding-top: 5px; margin-bottom: 3px; position: relative; top: -2px; justify-content: flex-start;">
            <button class="msg-btn btn-return" id="btn-return" style="height: 28px; width: 55px; font-size: 0.68rem; padding: 2px;">RETURN</button>
        </div>
    `;
}

function formatTafLine(item) {
    if (item.isBlank) {
        return '&nbsp;';
    }
    
    let text = item.text;
    const isHighlighted = item.highlight;
    
    if (text.startsWith('TAF')) {
        const parts = text.split(' ');
        let result = [];
        
        let icaoIndex = 1;
        if (parts[1] === 'AMD' || parts[1] === 'COR') {
            icaoIndex = 2;
        }
        
        let issueTimeIndex = icaoIndex + 1;
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i < icaoIndex) {
                result.push(`<span class="text-white-fms">${part}</span>`);
            } else if (i === icaoIndex) {
                result.push(`<span style="color: var(--text-cyan); font-weight: bold;">${part}</span>`);
            } else if (i === issueTimeIndex) {
                result.push(`<span class="text-white-fms">${part}</span>`);
            } else {
                // For validity and weather details on the main line: if highlighted, color them all green!
                const colorClass = isHighlighted ? 'text-green-fms' : 'text-white-fms';
                result.push(`<span class="${colorClass}">${part}</span>`);
            }
        }
        return result.join(' ');
    } else {
        // For sub-lines (BECMG, TEMPO, FM, etc.): if highlighted, color the entire line green!
        if (isHighlighted) {
            return `<span class="text-green-fms">${text}</span>`;
        } else {
            return `<span class="text-white-fms">${text}</span>`;
        }
    }
}

function getProcessedEnrteWxData() {
    let rawLines = [];
    let windowHours = 1.0;
    let allowedIcaos = null;
    
    if (activeEnrteWxTab === 'ALTN') {
        if (!flightData.altnWeatherRaw || flightData.altnWeatherRaw.length === 0) {
            return [];
        }
        rawLines = flightData.altnWeatherRaw;
        windowHours = 1.0;
    } else {
        if (!flightData.enrteWeatherRaw || flightData.enrteWeatherRaw.length === 0) {
            return [];
        }
        rawLines = flightData.enrteWeatherRaw;
        windowHours = 3.0;
        allowedIcaos = [
            'PANC', 'PACD', 
            'RJAA', 'RJTT', 'RJCC', 'RJSS', 'RJBB', 
            'KSEA', 'KSFO', 'KORD', 'KOAK', 'KLAX', 'KONT', 'PHNL', 'KJFK', 'KBOS', 'KPHL', 'KIAD', 
            'CYVR', 'CYUL', 'CYEG', 'CYWG', 'CYYZ', 
            'RKSI', 'RKSS', 'RKTU', 'RKPC', 'RKPK'
        ];
    }
    
    const highlightedData = parseTafLinesWithWindow(rawLines, windowHours, allowedIcaos);
    
    const tafData = [];
    for (let i = 0; i < highlightedData.length; i++) {
        const item = highlightedData[i];
        if (item.text.startsWith('TAF') && i > 0) {
            tafData.push({ isBlank: true });
        }
        tafData.push(item);
    }
    return tafData;
}

function getDepArrWxTableHTML() {
    let html = '';
    let rawLines = [];
    let targetDay = '';
    let targetTime = '';

    const isDepTab = activeDepArrWxTab === 'DEP';

    // ── METAR 행 (항상 상단에 표시) ──────────────────────────────
    const metarObj = isDepTab ? flightData.depMetar : flightData.arrMetar;
    const metarLabel = isDepTab
        ? (flightData.from || 'DEP')
        : (flightData.to   || 'ARR');
    html += buildMetarRows(metarObj, metarLabel);
    // ─────────────────────────────────────────────────────────────

    if (isDepTab) {
        if (!flightData.depWeatherRaw || flightData.depWeatherRaw.length === 0) {
            for (let i = 0; i < 10; i++) {
                html += `<tr style="height: 24px;"><td style="padding: 2px 4px;"></td></tr>`;
            }
            return html;
        }
        rawLines = flightData.depWeatherRaw;
        targetDay = flightData.flightDay || '08';
        targetTime = flightData.etd || '17:10';
    } else {
        if (!flightData.arrWeatherRaw || flightData.arrWeatherRaw.length === 0) {
            for (let i = 0; i < 10; i++) {
                html += `<tr style="height: 24px;"><td style="padding: 2px 4px;"></td></tr>`;
            }
            return html;
        }
        rawLines = flightData.arrWeatherRaw;
        const depDay = flightData.flightDay || '08';
        const depTime = flightData.etd || '17:10';
        const arrTime = flightData.eta || '06:12';
        targetDay = getArrivalDay(depDay, depTime, arrTime);
        targetTime = arrTime;
    }

    // ── TAF (OFP 원문) ────────────────────────────────────────────
    const tafData = parseTafLines(rawLines, targetDay, targetTime);
    for (let i = 0; i < 10; i++) {   // METAR 행 추가로 TAF는 10행으로 축소
        const item = tafData[i];
        if (!item) {
            html += `<tr style="height: 24px;"><td style="padding: 2px 4px;"></td></tr>`;
            continue;
        }
        html += `
            <tr style="height: auto;">
                <td style="font-size: 0.72rem; line-height: 1.35; padding: 4px 6px;
                           font-family: 'Share Tech Mono', monospace; word-break: break-all; text-align: left;">
                    ${formatTafLine(item)}
                </td>
            </tr>`;
    }
    return html;
}

function getEnrteWxTableHTML() {
    let html = '';
    const tafData = getProcessedEnrteWxData();

    for (let i = 0; i < 13; i++) {
        const item = tafData[enrteWxScrollIndex + i];
        if (!item) {
            html += `
                <tr style="height: 24px;">
                    <td style="padding: 2px 4px;"></td>
                </tr>
            `;
            continue;
        }
        
        if (item.isBlank) {
            html += `
                <tr style="height: 24px;">
                    <td style="padding: 2px 4px;">&nbsp;</td>
                </tr>
            `;
            continue;
        }
        
        html += `
            <tr style="height: auto;">
                <td style="font-size: 0.72rem; line-height: 1.35; padding: 4px 6px; font-family: 'Share Tech Mono', monospace; word-break: break-all; text-align: left;">
                    ${formatTafLine(item)}
                </td>
            </tr>
        `;
    }
    return html;
}

function renderDepArrWxPage() {
    resetTitleBar();
    pageTitleText.textContent = 'ACTIVE/DEP/ARR WX';
    btnInit.classList.remove('active');

    const isDepActive = activeDepArrWxTab === 'DEP';

    mainContent.innerHTML = `
        <!-- Folder Tabs -->
        <div class="fms-tabs" style="margin-bottom: 6px;">
            <div class="fms-tab ${isDepActive ? 'active' : ''}" id="tab-dep-arr-wx-active">DEP WX</div>
            <div class="fms-tab ${!isDepActive ? 'active' : ''}" id="tab-dep-arr-wx-crew">ARR WX</div>
        </div>

        <!-- Row 1: FLT NUMBER & Page Number & Navigation -->
        <div class="fms-row" style="margin-bottom: 2px;">
            <div class="fms-cell" style="justify-content: space-between; align-items: center; width: 100%;">
                <div class="cell-left" style="gap: 10px; align-items: center;">
                    <span class="fms-label" style="width: auto; margin-right: 0;">FLT NUMBER</span>
                    <div class="fms-val-box cyan-text" style="width: 140px; justify-content: space-between;">
                        <span>${flightData.fltNbr || 'AAR201'}</span><span class="arrow-down">▼</span>
                    </div>
                </div>
                <div class="cell-right" style="gap: 12px; align-items: center;">
                    <span class="text-white-fms" style="font-size: 0.85rem;">1/1</span>
                    <div style="display: flex; gap: 4px;">
                        <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">◀◀</button>
                        <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▶▶</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Row 2: ETD/ETA & LOCAL -->
        <div class="fms-row" style="margin-bottom: 4px;">
            <div class="fms-cell" style="justify-content: flex-start; gap: 8px; font-size: 0.9rem;">
                <span class="text-white-fms">${isDepActive ? 'ETD' : 'ETA'}</span>
                <span class="text-green-fms" style="font-weight: bold; margin-right: 15px;">
                    ${isDepActive 
                        ? (flightData.etd ? flightData.etd.replace(':', '') + 'Z' : '1710Z') 
                        : (flightData.eta ? flightData.eta.replace(':', '') + 'Z' : '0612Z')}
                </span>
                <span class="text-white-fms">LOCAL</span>
                <span style="color: var(--text-green); font-weight: bold;">
                    ${isDepActive 
                        ? getLocalTimeStr(flightData.etd || '17:10', getAirportOffset(flightData.from || 'KLAX')) 
                        : getLocalTimeStr(flightData.eta || '06:12', getAirportOffset(flightData.to || 'RKSI'))}
                </span>
            </div>
        </div>

        <!-- Table (13 rows) -->
        <table class="rte-summary-table mel-cdl-table" style="margin-bottom: 4px;">
            <tbody>
                ${getDepArrWxTableHTML()}
            </tbody>
        </table>

        <!-- Table Vertical Scroll Navigation (Hidden for TAF) -->
        <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 4px; visibility: hidden; height: 28px;">
            <button class="fms-btn-grey fms-btn-scroll" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▼▼</button>
            <button class="fms-btn-grey fms-btn-scroll" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▲▲</button>
        </div>

        <!-- Bottom Actions Row -->
        <div class="fms-row" style="margin-top: auto; padding-top: 5px; margin-bottom: 3px; position: relative; top: -2px; justify-content: flex-start;">
            <button class="msg-btn btn-return" id="btn-return" style="height: 28px; width: 55px; font-size: 0.68rem; padding: 2px;">RETURN</button>
        </div>
    `;
}

function getNotamWarningBannerHTML() {
    return `<div style="text-align:center; font-size:0.7rem; font-weight:bold; color:var(--text-red); margin-bottom:4px;">
        &lt;중요&gt; OFP NOTAM PACKAGE를 참고하세요
    </div>`;
}

function renderDepArrNotamPage() {
    resetTitleBar();
    pageTitleText.textContent = 'ACTIVE/DEP/ARR NOTAM';
    btnInit.classList.remove('active');

    const isDepActive = activeDepArrNotamTab === 'DEP';

    mainContent.innerHTML = `
        <!-- Folder Tabs -->
        <div class="fms-tabs" style="margin-bottom: 6px;">
            <div class="fms-tab ${isDepActive ? 'active' : ''}" id="tab-dep-notam-active">DEP NOTAM</div>
            <div class="fms-tab ${!isDepActive ? 'active' : ''}" id="tab-arr-notam">ARR NOTAM</div>
        </div>

        ${getNotamWarningBannerHTML()}

        <!-- Row 1: FLT NUMBER & Page Number & Navigation -->
        <div class="fms-row" style="margin-bottom: 2px;">
            <div class="fms-cell" style="justify-content: space-between; align-items: center; width: 100%;">
                <div class="cell-left" style="gap: 10px; align-items: center;">
                    <span class="fms-label" style="width: auto; margin-right: 0;">FLT NUMBER</span>
                    <div class="fms-val-box cyan-text" style="width: 140px; justify-content: space-between;">
                        <span>${flightData.fltNbr || 'AAR201'}</span><span class="arrow-down">▼</span>
                    </div>
                </div>
                <div class="cell-right" style="gap: 12px; align-items: center;">
                    <span class="text-white-fms" style="font-size: 0.85rem;">1/1</span>
                    <div style="display: flex; gap: 4px;">
                        <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">◀◀</button>
                        <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▶▶</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Row 2: ETD/ETA & LOCAL -->
        <div class="fms-row" style="margin-bottom: 4px;">
            <div class="fms-cell" style="justify-content: flex-start; gap: 8px; font-size: 0.9rem;">
                <span class="text-white-fms">${isDepActive ? 'ETD' : 'ETA'}</span>
                <span class="text-green-fms" style="font-weight: bold; margin-right: 15px;">
                    ${isDepActive
                        ? (flightData.etd ? flightData.etd.replace(':', '') + 'Z' : '----Z')
                        : (flightData.eta ? flightData.eta.replace(':', '') + 'Z' : '----Z')}
                </span>
                <span class="text-white-fms">LOCAL</span>
                <span style="color: var(--text-green); font-weight: bold;">
                    ${isDepActive
                        ? getLocalTimeStr(flightData.etd || '00:00', getAirportOffset(flightData.from || 'RKSI'))
                        : getLocalTimeStr(flightData.eta || '00:00', getAirportOffset(flightData.to || 'KJFK'))}
                </span>
            </div>
        </div>

        <!-- Table (13 rows - empty placeholder) -->
        <table class="rte-summary-table mel-cdl-table" style="margin-bottom: 4px;">
            <tbody id="dep-arr-notam-table-body">
                ${getDepArrNotamTableHTML()}
            </tbody>
        </table>

        <!-- Table Vertical Scroll Navigation -->
        <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 4px; height: 28px;">
            <button class="fms-btn-grey fms-btn-scroll" id="btn-dep-notam-scroll-down" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▼▼</button>
            <button class="fms-btn-grey fms-btn-scroll" id="btn-dep-notam-scroll-up" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▲▲</button>
        </div>

        <!-- Bottom Actions Row -->
        <div class="fms-row" style="margin-top: auto; padding-top: 5px; margin-bottom: 3px; position: relative; top: -2px; justify-content: flex-start;">
            <button class="msg-btn btn-return" id="btn-return" style="height: 28px; width: 55px; font-size: 0.68rem; padding: 2px;">RETURN</button>
        </div>
    `;
}

// ── NOTAM static data ─────────────────────────────────────────────
// type: 'hdr-red' | 'hdr-yellow' | 'hdr-green' | 'body' | 'body-hl' | 'blank'
const depNotamLines = [
    { type: 'hdr-yellow', text: '⚠️  GPS' },
    { type: 'body-hl',    text: '  G2263/26: RAIM OUTAGE (NPA)' },
    { type: 'body-hl',    text: '  29MAY 1248-1251Z, 1311-1333Z' },
    { type: 'body-hl',    text: '  Z0511/24: GPS 간섭경보 상시유효(UFN)' },
    { type: 'body',       text: '  → ICN/GMP 구역, GPWS 오경보 가능' },
    { type: 'blank',      text: '' },
    { type: 'hdr-green',  text: '🛫  RUNWAY' },
    { type: 'body',       text: '  A0478/26: SIPA 시범운용 중' },
    { type: 'body',       text: '  RWY 33R/34L, 15L/16R (16APR~10JUN26)' },
    { type: 'blank',      text: '' },
    { type: 'hdr-green',  text: '📡  NAVAID' },
    { type: 'body',       text: '  A0407/26: VOR/DME 점검 일정 변경' },
    { type: 'body',       text: '  NCN: 매월 5·9·15·21·27일 1500-1900Z' },
    { type: 'body',       text: '  WNG: 매월 4·8·14·20·26일 1500-1900Z' },
    { type: 'blank',      text: '' },
    { type: 'hdr-green',  text: '💬  COMPANY' },
    { type: 'body',       text: '  COAD03/26: 유사 콜사인 주의' },
    { type: 'body',       text: '  OZ335/OZ3355, OZ601/KE601' },
    { type: 'body',       text: '  OZ756/OZ356, OZ349/OZ339' },
    { type: 'body',       text: '  COAD04/26: RUGMA → DCT OLMEN 권고' },
    { type: 'body',       text: '  (Z85 경유 비권장, ICN ACC 협의 완료)' },
];

const arrNotamLines = [
    { type: 'hdr-red',    text: '🔴  APPROACH' },
    { type: 'body-hl',    text: '  A5219/26: KENNEDY 5 SID' },
    { type: 'body-hl',    text: '  LGA VOR/DME U/S → NEION DEP NA' },
    { type: 'body-hl',    text: '  (GPS 장착 항공기만 가능)' },
    { type: 'body-hl',    text: '  A5222/26: ILS/LOC RWY 31R' },
    { type: 'body-hl',    text: '  MA: 4000ft CAGAG HOLD (RNAV 1-GPS 필수)' },
    { type: 'body',       text: '  A5218/26: ILS/LOC RWY 13L CAT II' },
    { type: 'body',       text: '  DME 필수 (LGA VOR/DME 영향)' },
    { type: 'body',       text: '  A5190/26: ILS/LOC RWY 4L' },
    { type: 'body',       text: '  CMK VOR U/S → DME 필수' },
    { type: 'body',       text: '  A5147/26: RWY 22L PAPI U/S' },
    { type: 'body',       text: '  A4843/26: ILS RWY 22L IM U/S' },
    { type: 'body',       text: '  A4842/26: ILS RWY 04R IM U/S' },
    { type: 'blank',      text: '' },
    { type: 'hdr-yellow', text: '⚠️  RUNWAY' },
    { type: 'body',       text: '  A4380/26: RWY 31L TKOF HOLD LGT U/S' },
    { type: 'body',       text: '  A3783/26: RWY 31L Lead-on LGT/KE U/S' },
    { type: 'body',       text: '  A3773/26: RWY 13R Lead-off LGT/KE U/S' },
    { type: 'blank',      text: '' },
    { type: 'hdr-yellow', text: '🚧  TAXIWAY CLOSURES' },
    { type: 'body',       text: '  TWY B (KF~M) CLSD' },
    { type: 'body',       text: '  TWY Z (04L/22R~Y) CLSD' },
    { type: 'body',       text: '  TWY KG (A~B) CLSD UFN' },
    { type: 'body',       text: '  TWY L (A~B) CLSD UFN' },
    { type: 'body',       text: '  TWY PB (Hgr12~Q) CLSD UFN' },
    { type: 'blank',      text: '' },
    { type: 'hdr-green',  text: '🏢  TERMINAL 1' },
    { type: 'body',       text: '  A4509/25: T1 Ramp WIP 공사 진행 중' },
    { type: 'body',       text: '  ARR Gate 5,7,8 → L1도어' },
    { type: 'body',       text: '  DEP 전체 → L2도어' },
    { type: 'blank',      text: '' },
    { type: 'hdr-green',  text: '📡  NAVAID' },
    { type: 'body',       text: '  A3778/26: HTO VOR U/S (~30SEP26)' },
];

const altnNotamLines = [
    { type: 'hdr-red',    text: '🔴  APPROACH' },
    { type: 'body-hl',    text: '  A3093/26: ILS RWY 26 U/S (~30JUN26)' },
    { type: 'body-hl',    text: '  A2988/26: RWY 26 PAPI U/S' },
    { type: 'body-hl',    text: '  A2278/26: ILS RWY 27R GP U/S (~31OCT26)' },
    { type: 'body-hl',    text: '  A2078/26: RWY 09L ALS U/S (~31JUL26)' },
    { type: 'body',       text: '  A2969/26: ILS RWY 27R CAT II NA' },
    { type: 'body',       text: '  A2968/26: ILS RWY 09L CAT II NA' },
    { type: 'body',       text: '  A0876/26: RWY 27L PAPI U/S' },
    { type: 'body',       text: '  A2408/26: ILS Z RWY 9R CAT II' },
    { type: 'body',       text: '  → Radio Alt 없으면 NA, IM U/S' },
    { type: 'body',       text: '  A3914/25: ILS/LOC RWY 26' },
    { type: 'body',       text: '  GPS 없으면 절차 진입 NA' },
    { type: 'blank',      text: '' },
    { type: 'hdr-yellow', text: '⚠️  RUNWAY' },
    { type: 'body',       text: '  A3363/26: RWY 09R/27L CLSD' },
    { type: 'body',       text: '  DLY 0300-1100 (27~30MAY26)' },
    { type: 'blank',      text: '' },
    { type: 'hdr-yellow', text: '🚧  TAXIWAY CLOSURES' },
    { type: 'body',       text: '  TWY S5, S, W, P6, T, SS3, Z' },
    { type: 'body',       text: '  DLY 0200-1100 (27~30MAY26)' },
    { type: 'body',       text: '  TWY S (P6~N) CLSD ~13JUN26' },
    { type: 'body',       text: '  TWY E/E4/E5 CLSD ~09JUN26' },
    { type: 'body',       text: '  TWY S/S9/S10 CLSD ~17JUL26' },
    { type: 'body',       text: '  TWY S4 CLSD ~31MAY26' },
];

function highlightNotamKeywords(text) {
    // Wrap specific aviation keywords in yellow <span>
    // Order matters: longer/more specific patterns first
    return text
        // Runway designators: RWY 33L, RWY 04R, RWY 16C, RWY 9/27 etc.
        .replace(/\b(RWY\s+\d{1,2}[LCR]?(?:\/\d{1,2}[LCR]?)?)\b/g,
            '<span style="color:#f0c040;font-weight:bold;">$1</span>')
        // Taxiway names: TWY A, TWY B3, TWY KG etc.
        .replace(/\b(TWY\s+[A-Z]{1,3}\d*)\b/g,
            '<span style="color:#f0c040;font-weight:bold;">$1</span>')
        // Approach / navaid types
        .replace(/\b(ILS(?:\s+OR\s+LOC)?|RNAV|VOR(?:\/DME)?|LOC(?:\/DME)?|NDB(?:\/DME)?|TACAN|LLZ(?:\/DME)?|PAPI|VASI|ALS|SID|IAP|ODP|GNSS|RAIM|GPS|DME|GLS|LPV|LNAV(?:\/VNAV)?)\b/g,
            '<span style="color:#f0c040;font-weight:bold;">$1</span>');
}

function renderNotamRows(lines, scrollIndex) {
    const ROWS = 13;
    let html = '';
    for (let i = 0; i < ROWS; i++) {
        const item = lines[scrollIndex + i];
        if (!item) {
            html += `<tr style="height:22px;"><td style="padding:1px 4px;"></td></tr>`;
            continue;
        }
        if (item.type === 'blank') {
            html += `<tr style="height:10px;"><td></td></tr>`;
            continue;
        }
        // ETP airport title — large, prominent, cyan header
        if (item.type === 'etp-title') {
            html += `
                <tr style="height:auto;">
                    <td style="font-size:0.82rem;line-height:1.5;padding:8px 4px 4px 4px;
                        font-family:'Share Tech Mono',monospace;
                        color:var(--text-cyan);font-weight:bold;
                        border-top:2px solid var(--text-cyan);letter-spacing:0.01em;">
                        ${item.text}
                    </td>
                </tr>`;
            continue;
        }
        const isHdr = item.type.startsWith('hdr');
        const color = item.type === 'hdr-red'    ? '#ff6b6b'
                    : item.type === 'hdr-yellow'  ? '#f0c040'
                    : item.type === 'hdr-amber'   ? '#ffbf00'
                    : item.type === 'hdr-green'   ? 'var(--text-green)'
                    : item.type === 'body-hl'     ? '#ffffff'
                    : '#ffffff';
        const weight = isHdr ? 'bold' : 'normal';
        const borderTop = isHdr ? 'border-top:1px solid #2f3542;' : '';
        // Apply keyword highlighting only to body lines (not headers)
        const displayText = isHdr ? item.text : highlightNotamKeywords(item.text);
        html += `
            <tr style="height:auto;">
                <td style="font-size:0.72rem;line-height:1.4;padding:${isHdr ? '5px' : '2px'} 4px;
                    font-family:'Share Tech Mono',monospace;color:${color};
                    font-weight:${weight};${borderTop}">
                    ${displayText}
                </td>
            </tr>`;
    }
    return html;
}

function getDepArrNotamTableHTML() {
    let lines;
    if (activeDepArrNotamTab === 'DEP') {
        if (flightData.depNotamEntries && flightData.depNotamEntries.length > 0) {
            lines = buildNotamDisplayLines(flightData.depNotamEntries, flightData.from || 'RKSI', flightData.depRunwayInfo);
        } else {
            lines = [];
        }
    } else {
        if (flightData.arrNotamEntries && flightData.arrNotamEntries.length > 0) {
            lines = buildNotamDisplayLines(flightData.arrNotamEntries, flightData.to || 'KJFK', flightData.arrRunwayInfo);
        } else {
            lines = [];
        }
    }
    return renderNotamRows(lines, depArrNotamScrollIndex);
}

function renderEnrteNotamPage() {
    resetTitleBar();
    pageTitleText.textContent = 'ACTIVE/ENRTE NOTAM';
    btnInit.classList.remove('active');

    const isAltnActive = activeEnrteNotamTab === 'ALTN';

    mainContent.innerHTML = `
        <!-- Folder Tabs -->
        <div class="fms-tabs" style="margin-bottom: 6px;">
            <div class="fms-tab ${isAltnActive ? 'active' : ''}" id="tab-enrte-notam-altn">ALTN NOTAM</div>
            <div class="fms-tab ${!isAltnActive ? 'active' : ''}" id="tab-enrte-notam-era">EDTO NOTAM</div>
        </div>

        ${getNotamWarningBannerHTML()}

        <!-- Row 1: FLT NUMBER & ALTN AIRPORT -->
        <div class="fms-row" style="margin-bottom: 2px;">
            <div class="fms-cell" style="justify-content: space-between; align-items: center; width: 100%;">
                <div class="cell-left" style="gap: 10px; align-items: center;">
                    <span class="fms-label" style="width: auto; margin-right: 0;">FLT NUMBER</span>
                    <div class="fms-val-box cyan-text" style="width: 100px; justify-content: space-between;">
                        <span>${flightData.fltNbr || '----'}</span><span class="arrow-down">▼</span>
                    </div>
                </div>
                <div class="cell-right" style="gap: 10px; align-items: center;">
                    ${isAltnActive ? `
                    <span class="fms-label" style="width: auto; margin-right: 0;">ALTN</span>
                    <div class="fms-val-box cyan-text" style="width: 70px;">
                        <span>${flightData.altn || '----'}</span>
                    </div>
                    ` : `
                    <span style="color:var(--text-cyan); font-size:0.78rem; font-weight:bold;">
                        EDTO / ETP ${flightData.etpNotamSections && flightData.etpNotamSections.length > 0 ? '(' + flightData.etpNotamSections.length + ' airports)' : ''}
                    </span>
                    `}
                    <span class="text-white-fms" style="font-size: 0.85rem;">1/1</span>
                    <div style="display: flex; gap: 4px;">
                        <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">◀◀</button>
                        <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▶▶</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Row 2: ALTN ETA & LOCAL -->
        <div class="fms-row" style="margin-bottom: 4px;">
            <div class="fms-cell" style="justify-content: flex-start; gap: 8px; font-size: 0.9rem;">
                ${isAltnActive ? `
                <span class="text-white-fms">ALTN</span>
                <span class="text-green-fms" style="font-weight: bold; margin-right: 8px;">${flightData.altn || '----'}</span>
                <span class="text-white-fms">ETA</span>
                <span class="text-green-fms" style="font-weight: bold; margin-right: 15px;">
                    ${flightData.eta ? flightData.eta.replace(':', '') + 'Z' : '----Z'}
                </span>
                <span class="text-white-fms">LOCAL</span>
                <span style="color: var(--text-green); font-weight: bold;">
                    ${getLocalTimeStr(flightData.eta || '00:00', getAirportOffset(flightData.altn || 'KPHL'))}
                </span>
                ` : `
                <span class="text-white-fms">EDTO NOTAM</span>
                <span style="color:var(--text-cyan); font-size:0.78rem; margin-left:8px;">
                    ${flightData.etpNotamSections && flightData.etpNotamSections.length > 0
                        ? '— ETP ' + flightData.etpNotamSections.map(s => {
                            const m = s.title.match(/\[ETP\]\s*([A-Z]{4})\b/i);
                            return m ? m[1] : '';
                          }).filter(Boolean).join(' / ')
                        : '— PDF에서 PACKAGE 2 가져오기'}
                </span>
                `}
            </div>
        </div>

        <!-- Table (13 rows - empty placeholder) -->
        <table class="rte-summary-table mel-cdl-table" style="margin-bottom: 4px;">
            <tbody id="enrte-notam-table-body">
                ${getEnrteNotamTableHTML()}
            </tbody>
        </table>

        <!-- Table Vertical Scroll Navigation -->
        <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 4px; height: 28px;">
            <button class="fms-btn-grey fms-btn-scroll" id="btn-enrte-notam-scroll-down" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▼▼</button>
            <button class="fms-btn-grey fms-btn-scroll" id="btn-enrte-notam-scroll-up" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▲▲</button>
        </div>

        <!-- Bottom Actions Row -->
        <div class="fms-row" style="margin-top: auto; padding-top: 5px; margin-bottom: 3px; position: relative; top: -2px; justify-content: flex-start;">
            <button class="msg-btn btn-return" id="btn-return" style="height: 28px; width: 55px; font-size: 0.68rem; padding: 2px;">RETURN</button>
        </div>
    `;
}

function getEnrteNotamTableHTML() {
    let lines;
    if (activeEnrteNotamTab === 'ALTN') {
        if (flightData.altnNotamEntries && flightData.altnNotamEntries.length > 0) {
            lines = buildNotamDisplayLines(flightData.altnNotamEntries, flightData.altn || 'KPHL', flightData.altnRunwayInfo);
        } else {
            lines = [];
        }
    } else {
        // EDTO NOTAM — ETP sections from NOTAM PACKAGE 2
        lines = buildEtpNotamDisplayLines();
    }
    return renderNotamRows(lines, enrteNotamScrollIndex);
}

function getEraFirNotamTableHTML() {
    if (activeEraFirNotamTab === 'FIR') {
        return getFirNotamTableHTML();
    }
    // ERA — future: parse from NOTAM PACKAGE 2 [ERA]
    return renderNotamRows([], eraFirNotamScrollIndex);
}

function renderEraFirNotamPage() {
    resetTitleBar();
    pageTitleText.textContent = 'ACTIVE/ERA·FIR NOTAM';
    btnInit.classList.remove('active');

    const isEraActive = activeEraFirNotamTab === 'ERA';

    mainContent.innerHTML = `
        <!-- Folder Tabs -->
        <div class="fms-tabs" style="margin-bottom: 6px;">
            <div class="fms-tab ${isEraActive ? 'active' : ''}" id="tab-era-fir-notam-era">ERA NOTAM</div>
            <div class="fms-tab ${!isEraActive ? 'active' : ''}" id="tab-era-fir-notam-fir">FIR NOTAM</div>
        </div>

        ${getNotamWarningBannerHTML()}

        <!-- Row 1: FLT NUMBER & active tab label -->
        <div class="fms-row" style="margin-bottom: 2px;">
            <div class="fms-cell" style="justify-content: space-between; align-items: center; width: 100%;">
                <div class="cell-left" style="gap: 10px; align-items: center;">
                    <span class="fms-label" style="width: auto; margin-right: 0;">FLT NUMBER</span>
                    <div class="fms-val-box cyan-text" style="width: 100px; justify-content: space-between;">
                        <span>${flightData.fltNbr || '----'}</span><span class="arrow-down">▼</span>
                    </div>
                </div>
                <div class="cell-right" style="gap: 10px; align-items: center;">
                    <span style="color:#666; font-size:0.78rem;">${isEraActive ? 'ERA NOTAM' : 'FIR NOTAM'}</span>
                    <span class="text-white-fms" style="font-size: 0.85rem;">1/1</span>
                    <div style="display: flex; gap: 4px;">
                        <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">◀◀</button>
                        <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▶▶</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Row 2: tab subtitle -->
        <div class="fms-row" style="margin-bottom: 4px;">
            <div class="fms-cell" style="justify-content: space-between; align-items: center; width: 100%;">
                <span class="text-white-fms" style="font-size:0.85rem;">
                    ${isEraActive
                        ? 'ERA NOTAM — 미구현 (PACKAGE 2 ERA)'
                        : (() => {
                            const s = flightData.firAiStatus;
                            const cnt = (flightData.firNotamSections || []).length;
                            if (cnt === 0) return 'FIR NOTAM — OFP 미로드';
                            if (s === 'loading') return `FIR NOTAM (${cnt}개 FIR) — AI 요약 중...`;
                            if (s === 'done')    return `FIR NOTAM (${cnt}개 FIR) — AI 요약 완료`;
                            if (s === 'error')   return `FIR NOTAM (${cnt}개 FIR) — 요약 오류`;
                            return `FIR NOTAM (${cnt}개 FIR)`;
                          })()
                    }
                </span>
            </div>
        </div>

        <!-- Table (13 rows) -->
        <table class="rte-summary-table mel-cdl-table" style="margin-bottom: 4px;">
            <tbody id="era-fir-notam-table-body">
                ${getEraFirNotamTableHTML()}
            </tbody>
        </table>

        <!-- Scroll Buttons -->
        <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 4px; height: 28px;">
            <button class="fms-btn-grey fms-btn-scroll" id="btn-era-fir-notam-scroll-down" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▼▼</button>
            <button class="fms-btn-grey fms-btn-scroll" id="btn-era-fir-notam-scroll-up" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▲▲</button>
        </div>

        <!-- Bottom Actions -->
        <div class="fms-row" style="margin-top: auto; padding-top: 5px; margin-bottom: 3px; position: relative; top: -2px; justify-content: flex-start;">
            <button class="msg-btn btn-return" id="btn-return" style="height: 28px; width: 55px; font-size: 0.68rem; padding: 2px;">RETURN</button>
        </div>
    `;
}

function renderEnrteWxPage() {
    resetTitleBar();
    pageTitleText.textContent = 'ACTIVE/ENRTE WX';
    btnInit.classList.remove('active');

    const isAltnActive = activeEnrteWxTab === 'ALTN';

    mainContent.innerHTML = `
        <!-- Folder Tabs -->
        <div class="fms-tabs" style="margin-bottom: 6px;">
            <div class="fms-tab ${isAltnActive ? 'active' : ''}" id="tab-enrte-wx-active">ALTN WX</div>
            <div class="fms-tab ${!isAltnActive ? 'active' : ''}" id="tab-enrte-wx-crew">ERA WX</div>
        </div>

        <!-- Row 1: FLT NUMBER & Page Number & Navigation -->
        <div class="fms-row" style="margin-bottom: 2px;">
            <div class="fms-cell" style="justify-content: space-between; align-items: center; width: 100%;">
                <div class="cell-left" style="gap: 10px; align-items: center;">
                    <span class="fms-label" style="width: auto; margin-right: 0;">FLT NUMBER</span>
                    <div class="fms-val-box cyan-text" style="width: 140px; justify-content: space-between;">
                        <span>${flightData.fltNbr || 'AAR201'}</span><span class="arrow-down">▼</span>
                    </div>
                </div>
                <div class="cell-right" style="gap: 12px; align-items: center;">
                    <span class="text-white-fms" style="font-size: 0.85rem;">1/1</span>
                    <div style="display: flex; gap: 4px;">
                        <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">◀◀</button>
                        <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▶▶</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Row 2: ETA & LOCAL -->
        <div class="fms-row" style="margin-bottom: 4px;">
            <div class="fms-cell" style="justify-content: flex-start; gap: 8px; font-size: 0.9rem;">
                <span class="text-white-fms">ETA</span>
                <span class="text-green-fms" style="font-weight: bold; margin-right: 15px;">
                    ${flightData.eta ? flightData.eta.replace(':', '') + 'Z' : '0612Z'}
                </span>
                <span class="text-white-fms">LOCAL</span>
                <span style="color: var(--text-green); font-weight: bold;">
                    ${getLocalTimeStr(flightData.eta || '06:12', getAirportOffset(flightData.to || 'RKSI'))}
                </span>
            </div>
        </div>

        <!-- Table (13 rows) -->
        <div class="fms-weather-container" style="height: 330px; border: 1.5px solid #2f3542; background-color: #12141a; overflow-y: auto; margin-bottom: 4px; width: 100%;">
            <table class="rte-summary-table mel-cdl-table" style="margin-bottom: 0; border: none; background-color: transparent; width: 100%;">
                <tbody id="enrte-wx-table-body">
                    ${getEnrteWxTableHTML()}
                </tbody>
            </table>
        </div>

        <!-- Table Vertical Scroll Navigation -->
        <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 4px;">
            <button class="fms-btn-grey fms-btn-scroll" id="btn-enrte-wx-scroll-down" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▼▼</button>
            <button class="fms-btn-grey fms-btn-scroll" id="btn-enrte-wx-scroll-up" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▲▲</button>
        </div>

        <!-- Bottom Actions Row -->
        <div class="fms-row" style="margin-top: auto; padding-top: 5px; margin-bottom: 3px; position: relative; top: -2px; justify-content: flex-start;">
            <button class="msg-btn btn-return" id="btn-return" style="height: 28px; width: 55px; font-size: 0.68rem; padding: 2px;">RETURN</button>
        </div>
    `;
}

function renderRteSummaryPage() {
    resetTitleBar();
    pageTitleText.textContent = 'DATA/ROUTE';
    btnInit.classList.remove('active');

    const isPrimary = activeRteSummaryTab === 'PRIMARY';

    mainContent.innerHTML = `
        <!-- Folder Tabs -->
        <div class="fms-tabs" style="margin-bottom: 6px;">
            <div class="fms-tab ${isPrimary ? 'active' : ''}" id="tab-rte-primary">PRIMARY RTEs</div>
            <div class="fms-tab ${!isPrimary ? 'active' : ''}" id="tab-rte-alternate">ALTERNATE RTEs</div>
        </div>

        <!-- Row 1: RTE IDENT & Page Number & Navigation -->
        <div class="fms-row" style="margin-bottom: 2px;">
            <div class="fms-cell" style="justify-content: space-between; align-items: center; width: 100%;">
                <div class="cell-left" style="gap: 10px; align-items: center;">
                    <span class="fms-label" style="width: auto; margin-right: 0;">RTE IDENT</span>
                    <div class="fms-val-box cyan-text" style="width: 140px; justify-content: space-between;">
                        <span>${flightData.fltNbr}</span><span class="arrow-down">▼</span>
                    </div>
                </div>
                <div class="cell-right" style="gap: 12px; align-items: center;">
                    <span class="text-white-fms" style="font-size: 0.85rem;">1/5</span>
                    <div style="display: flex; gap: 4px;">
                        <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">◀◀</button>
                        <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▶▶</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Row 2: FROM TO -->
        <div class="fms-row" style="margin-bottom: 4px;">
            <div class="fms-cell" style="justify-content: flex-start; gap: 8px; font-size: 0.9rem;">
                <span class="text-white-fms">FROM</span>
                <span class="text-green-fms" style="font-weight: bold; margin-right: 15px;">${isPrimary ? (flightData.from || '----') : (flightData.to || '----')}</span>
                <span class="text-white-fms">TO</span>
                <span class="text-green-fms" style="font-weight: bold;">${isPrimary ? (flightData.to || '----') : (flightData.altn || '----')}</span>
            </div>
        </div>

        <!-- Route Summary Table — PRIMARY/ALTERNATE 모두 13행 고정, ▼▼/▲▲로 페이지 단위 이동 (스크롤 없음) -->
        <table class="rte-summary-table" style="margin-bottom: 4px;">
            <tbody>
                ${isPrimary ? getRteSummaryTableHTML() : getAltnRteSummaryTableHTML()}
            </tbody>
        </table>

        <!-- Table Vertical Scroll Navigation -->
        <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 4px;">
            <button class="fms-btn-grey fms-btn-scroll" id="btn-route-scroll-down" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▼▼</button>
            <button class="fms-btn-grey fms-btn-scroll" id="btn-route-scroll-up" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▲▲</button>
        </div>

        ${isPrimary && atsFplCompareResult ? `
        <div style="text-align:center; font-size:0.7rem; margin-bottom:2px; color:${atsFplCompareResult.isMatch ? 'var(--text-green)' : 'var(--text-red)'};">
            ${atsFplCompareResult.isMatch ? 'OFP와 ATS PLAN이 일치합니다' : '⚠ OFP와 ATS PLAN 루트가 다릅니다 — 확인 필요'}
        </div>` : ''}

        <!-- Bottom Actions Row (raised by 3px/3pt using margin/padding tweaks, plus 2pt more) -->
        <div class="fms-row" style="margin-top: auto; padding-top: 5px; margin-bottom: 3px; position: relative; top: -2px;">
            <div class="fms-cell" style="justify-content: space-between; align-items: center; width: 100%;">
                <div style="display: flex; gap: 6px;">
                    <button class="msg-btn btn-return" id="btn-return" style="height: 28px; width: 55px; font-size: 0.68rem; padding: 2px;">RETURN</button>
                </div>
                <div style="display: flex; gap: 6px; align-items: center;">
                    <button class="fms-btn-grey" style="font-size: 0.68rem; padding: 4px 6px; line-height: 1.2;">NEW RTE ▲</button>
                </div>
            </div>
        </div>
    `;
}

function saveMemoNotepadPages() {
    localStorage.setItem('ckpt_memo_notepad_pages', JSON.stringify(memoNotepadPages));
}

function saveMemoDrawpadPages() {
    try {
        localStorage.setItem('ckpt_memo_drawpad_pages', JSON.stringify(memoDrawpadPages));
    } catch (err) {
        console.error('[MEMO] DRAWPAD 저장 실패 (localStorage 용량 초과 가능):', err);
    }
}

function getNotepadHTML() {
    const text = memoNotepadPages[memoNotepadPageIndex] || '';
    return `
        <div style="display:flex; justify-content:flex-end; margin-bottom:6px;">
            <button class="fms-btn-grey" id="btn-memo-notepad-clear" style="font-size:0.65rem; padding:4px 8px;">전체 삭제</button>
        </div>
        <textarea id="memo-textarea" placeholder="여기에 자유롭게 메모를 입력하세요..." style="
            flex-grow: 1; width: 100%; resize: none; box-sizing: border-box;
            background-color: #111419; border: 1.5px solid #2f3542; border-radius: 4px;
            color: var(--text-green); font-family: 'Share Tech Mono', monospace;
            font-size: 0.85rem; padding: 8px; line-height: 1.4;
        ">${text}</textarea>
    `;
}

function getDrawpadHTML() {
    const colors = ['#888888', '#ffffff', '#4fc3f7', '#ff6b6b', '#ffd54f'];
    return `
        <div style="display:flex; gap:6px; margin-bottom:6px; align-items:center; flex-wrap:wrap;">
            ${colors.map(c => `
                <button class="memo-color-swatch" data-color="${c}" style="
                    width:22px; height:22px; border-radius:50%; padding:0; cursor:pointer;
                    background:${c}; border:2px solid ${c === memoDrawColor && !memoIsErasing ? '#fff' : '#2f3542'};
                "></button>
            `).join('')}
            <span style="width:1px; height:20px; background:#2f3542; margin:0 4px;"></span>
            <button class="fms-btn-grey" id="btn-memo-pen-thin" style="width:30px; height:26px; font-size:0.6rem;">●</button>
            <button class="fms-btn-grey" id="btn-memo-pen-thick" style="width:30px; height:26px; font-size:0.95rem;">●</button>
            <button class="fms-btn-grey" id="btn-memo-eraser" style="font-size:0.65rem; padding:4px 8px; ${memoIsErasing ? 'border-color: var(--text-cyan); color: var(--text-cyan);' : ''}">지우개</button>
            <button class="fms-btn-grey" id="btn-memo-clear" style="font-size:0.65rem; padding:4px 8px;">전체 삭제</button>
        </div>
        <div style="flex-grow:1; position:relative; border:1.5px solid #2f3542; border-radius:4px; overflow:hidden; background:#111419;">
            <canvas id="memo-canvas" style="width:100%; height:100%; touch-action:none; display:block;"></canvas>
        </div>
    `;
}

function initDrawpadHandlers() {
    const canvas = document.getElementById('memo-canvas');
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const saved = memoDrawpadPages[memoDrawpadPageIndex];
    if (saved) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
        img.src = saved;
    }

    let drawing = false, lastX = 0, lastY = 0;
    const getPos = (e) => {
        const r = canvas.getBoundingClientRect();
        const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
        const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
        return { x: cx, y: cy };
    };
    const start = (e) => {
        e.preventDefault();
        drawing = true;
        const p = getPos(e);
        lastX = p.x; lastY = p.y;
    };
    const move = (e) => {
        if (!drawing) return;
        e.preventDefault();
        const p = getPos(e);
        ctx.strokeStyle = memoIsErasing ? '#111419' : memoDrawColor;
        ctx.lineWidth = memoIsErasing ? memoDrawSize * 4 : memoDrawSize;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        lastX = p.x; lastY = p.y;
    };
    const end = () => {
        if (!drawing) return;
        drawing = false;
        memoDrawpadPages[memoDrawpadPageIndex] = canvas.toDataURL('image/png');
        saveMemoDrawpadPages();
    };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start);
    canvas.addEventListener('touchmove', move);
    canvas.addEventListener('touchend', end);
}

function renderMemoPage() {
    resetTitleBar();
    pageTitleText.textContent = 'MEMO';
    btnInit.classList.remove('active');

    const isNotepad = activeMemoTab === 'NOTEPAD';
    const pageCount = isNotepad ? memoNotepadPages.length : memoDrawpadPages.length;
    const pageIndex = isNotepad ? memoNotepadPageIndex : memoDrawpadPageIndex;

    mainContent.innerHTML = `
        <div class="fms-tabs" style="margin-bottom: 6px;">
            <div class="fms-tab ${isNotepad ? 'active' : ''}" id="tab-memo-notepad">NOTEPAD</div>
            <div class="fms-tab ${!isNotepad ? 'active' : ''}" id="tab-memo-drawpad">DRAWPAD</div>
        </div>
        ${isNotepad ? getNotepadHTML() : getDrawpadHTML()}
        <div class="fms-row" style="margin-top: auto; padding-top: 5px; margin-bottom: 3px; justify-content: space-between; align-items: center;">
            <button class="msg-btn btn-return" id="btn-return" style="height: 28px; width: 55px; font-size: 0.68rem; padding: 2px;">RETURN</button>
            <div style="display:flex; gap:6px; align-items:center;">
                <button class="fms-btn-grey" id="btn-memo-page-prev" style="width:34px; height:26px; font-size:0.65rem;">◀</button>
                <span style="font-size:0.75rem; color:var(--text-white);">${pageIndex + 1}/${pageCount}</span>
                <button class="fms-btn-grey" id="btn-memo-page-next" style="width:34px; height:26px; font-size:0.65rem;">▶</button>
                <button class="fms-btn-grey" id="btn-memo-page-new" style="font-size:0.65rem; padding:4px 8px;">+ NEW PAGE</button>
            </div>
        </div>
    `;

    if (isNotepad) {
        const ta = document.getElementById('memo-textarea');
        let saveTimer = null;
        ta.addEventListener('input', () => {
            memoNotepadPages[memoNotepadPageIndex] = ta.value;
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => saveMemoNotepadPages(), 400);
        });
    } else {
        initDrawpadHandlers();
    }
}

function renderFuelLoadPage() {
    resetTitleBar();
    pageTitleText.textContent = 'ACTIVE/FUEL&LOAD';
    btnInit.classList.remove('active');

    mainContent.innerHTML = `
        <!-- Row 1: ZFW and ZFWCG -->
        <div class="fms-row fms-row-condensed">
            <div class="fms-cell" style="justify-content: space-between;">
                <div class="cell-left" style="gap: 6px;">
                    <span class="fms-label">ZFW</span>
                    <div class="fms-val-box extracted-value" style="width: 130px;">
                        <input type="text" value="${flightData.zfw}" data-field="zfw">
                    </div>
                </div>
                <div class="cell-right" style="gap: 6px;">
                    <span class="fms-label label-right" style="width: 80px; text-align: right;">ZFWCG</span>
                    <div class="fms-val-box white-text" style="width: 100px;">
                        <input type="text" value="${flightData.zfwcg}" data-field="zfwcg">
                    </div>
                </div>
            </div>
        </div>

        <!-- Row 2: FOB Box below ZFW -->
        <div class="fms-row fms-row-condensed">
            <div class="fms-cell" style="justify-content: space-between;">
                <div class="cell-left" style="gap: 6px;">
                    <span class="fms-label">FOB</span>
                    <div class="fms-val-box extracted-value" style="width: 130px;">
                        <input type="text" value="${flightData.fob}" data-field="fob">
                    </div>
                </div>
            </div>
        </div>

        <div class="divider-line"></div>

        <!-- TAXI and PAX NBR -->
        <div class="fms-row">
            <div class="fms-cell" style="justify-content: space-between;">
                <div class="cell-left" style="gap: 6px;">
                    <span class="fms-label">TAXI</span>
                    <div class="fms-val-box extracted-value" style="width: 100px;">
                        <input type="text" value="${flightData.taxi}" data-field="taxi">
                    </div>
                </div>
                <div class="cell-right" style="gap: 6px;">
                    <span class="fms-label label-right" style="width: 80px; text-align: right;">PAX NBR</span>
                    <div class="fms-val-box extracted-value" style="width: 104px;">
                        <input type="text" value="${flightData.paxNbr}" data-field="paxNbr">
                    </div>
                </div>
            </div>
        </div>

        <!-- TRIP and CGO (Ton) -->
        <div class="fms-row">
            <div class="fms-cell" style="justify-content: space-between;">
                <div class="cell-left" style="gap: 6px;">
                    <span class="fms-label">TRIP</span>
                    <div class="fms-val-box extracted-value" style="width: 100px;">
                        <input type="text" value="${flightData.trip}" data-field="trip">
                    </div>
                    <div class="fms-val-box extracted-value" style="width: 80px;">
                        <input type="text" value="${flightData.tripTime}" data-field="tripTime">
                    </div>
                </div>
                <div class="cell-right" style="gap: 6px;">
                    <span class="fms-label label-right" style="width: 80px; text-align: right;">CGO (T)</span>
                    <div class="fms-val-box extracted-value" style="width: 104px;">
                        <input type="text" value="${flightData.cargoTons}" data-field="cargoTons">
                    </div>
                </div>
            </div>
        </div>

        <!-- RTE RSV and CI -->
        <div class="fms-row">
            <div class="fms-cell" style="justify-content: space-between;">
                <div class="cell-left" style="gap: 6px;">
                    <span class="fms-label" style="font-size: 0.75rem;">RTE RSV</span>
                    <div class="fms-val-box extracted-value" style="width: 100px;">
                        <input type="text" value="${flightData.rteRsv}" data-field="rteRsv">
                    </div>
                    <div class="fms-val-box white-text" style="width: 80px;">
                        <input type="text" value="${flightData.rteRsvPct}" data-field="rteRsvPct">
                    </div>
                </div>
                <div class="cell-right" style="gap: 6px;">
                    <span class="fms-label label-right" style="width: 80px; text-align: right;">CI</span>
                    <div class="fms-val-box extracted-value" style="width: 104px;">
                        <input type="text" value="${flightData.ci}" data-field="ci">
                    </div>
                </div>
            </div>
        </div>

        <!-- ALTN and TOW -->
        <div class="fms-row">
            <div class="fms-cell" style="justify-content: space-between;">
                <div class="cell-left" style="gap: 6px;">
                    <span class="fms-label">ALTN</span>
                    <div class="fms-val-box extracted-value" style="width: 100px;">
                        <input type="text" value="${flightData.altnFuel}" data-field="altnFuel">
                    </div>
                    <div class="fms-val-box extracted-value" style="width: 80px;">
                        <input type="text" value="${flightData.altnTime}" data-field="altnTime">
                    </div>
                </div>
                <div class="cell-right" style="gap: 6px;">
                    <span class="fms-label label-right" style="width: 80px; text-align: right;">TOW</span>
                    <div id="tow-display-val" style="width: 100px; text-align: center; color: var(--text-green); font-weight: bold; font-size: 0.95rem;">
                        ${flightData.tow}
                    </div>
                </div>
            </div>
        </div>

        <!-- FINAL and LW -->
        <div class="fms-row">
            <div class="fms-cell" style="justify-content: space-between;">
                <div class="cell-left" style="gap: 6px;">
                    <span class="fms-label">FINAL</span>
                    <div class="fms-val-box cyan-text" style="width: 100px;">
                        <input type="text" value="${flightData.final}" data-field="final">
                    </div>
                    <div class="fms-val-box cyan-text" style="width: 80px;">
                        <input type="text" value="${flightData.finalTime}" data-field="finalTime">
                    </div>
                </div>
                <div class="cell-right" style="gap: 6px;">
                    <span class="fms-label label-right" style="width: 80px; text-align: right;">LW</span>
                    <div id="lw-display-val" style="width: 100px; text-align: center; color: var(--text-green); font-weight: bold; font-size: 0.95rem;">
                        ${flightData.lw}
                    </div>
                </div>
            </div>
        </div>

        ${getFuelTableHTML()}

        <!-- RETURN button moved to bottom of page (above the MSG LIST footer) -->
        <div class="fms-row" style="margin-top: auto; padding-bottom: 2px;">
            <div class="fms-cell" style="justify-content: flex-start;">
                <button class="msg-btn btn-return" id="btn-return" style="height: 28px; width: 55px; font-size: 0.68rem; padding: 2px;">RETURN</button>
            </div>
        </div>
    `;
}

function renderStepAltsPage() {
    // Apply dark title bar styling matching the reference image
    const titleBar = document.querySelector('.page-title-bar');
    if (titleBar) {
        titleBar.style.backgroundColor = '#111419';
        titleBar.style.color = '#ffffff';
        titleBar.style.borderBottom = '1.5px solid #2f3542';
    }
    pageTitleText.innerHTML = `
        <span style="color: #ffffff; font-weight: bold;">ACTIVE/F-PLN/VERT REV</span>
    `;
    btnInit.classList.remove('active');

    const initialFL = stepAltData[0] ? stepAltData[0].alt.replace('FL', '') : (flightData.crzFl || '350');

    const zones = flightData.turbZones || [];
    
    let zonesHTML = '';
    if (zones.length > 0) {
        zonesHTML = zones.map(z => `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div style="color: #ffffff;">
                    AT <span style="color: ${z.color};">${z.label}</span>
                </div>
                <div style="color: #ffffff;">
                    SR <span style="color: ${z.color};">${z.sr}</span>
                </div>
                <div style="color: #ffffff; margin-right: 5px;">
                    TIME AFTER DEP <span style="color: ${z.color};">${z.time}</span>
                </div>
            </div>
        `).join('');
    } else {
        zonesHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div style="color: #ffffff;">
                    AT <span style="color: var(--text-green);">ETP2 / ASTER</span>
                </div>
                <div style="color: #ffffff;">
                    SR <span style="color: var(--text-green);">04-05</span>
                </div>
                <div style="color: #ffffff; margin-right: 5px;">
                    TIME AFTER DEP <span style="color: var(--text-green);">07+59 / 10+28</span>
                </div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div style="color: #ffffff;">
                    AT <span style="color: var(--text-red);">SDE / GTC</span>
                </div>
                <div style="color: #ffffff;">
                    SR <span style="color: var(--text-red);">08</span>
                </div>
                <div style="color: #ffffff; margin-right: 5px;">
                    TIME AFTER DEP <span style="color: var(--text-red);">10+44 / 10+58</span>
                </div>
            </div>
        `;
    }

    mainContent.innerHTML = `
        <!-- Folder Tabs -->
        <div class="fms-tabs" style="margin-bottom: 6px;">
            <div class="fms-tab">RTA</div>
            <div class="fms-tab">SPD</div>
            <div class="fms-tab">CMS</div>
            <div class="fms-tab">ALT</div>
            <div class="fms-tab active">STEP ALTs</div>
        </div>

        <!-- Table Container matching the reference image layout -->
        <div class="step-alt-table-container" style="border: 1.5px solid #2f3542; border-radius: 4px; padding: 8px 10px; background-color: #12141a; margin-bottom: 4px;">
            <div style="font-size: 0.82rem; margin-bottom: 6px; font-weight: bold; color: #ffffff;">
                STEP ALTs FROM CRZ <span style="color: var(--text-cyan);">FL</span> <span style="color: var(--text-green);">${initialFL}</span>
            </div>

            <!-- Table Grid -->
            <div class="step-alt-grid" style="display: grid; grid-template-columns: 1.15fr 0.95fr 0.95fr 0.95fr; gap: 4px; align-items: center;">
                <!-- Content generated dynamically by getStepAltsTableHTML() -->
            </div>
        </div>

        <!-- Table Vertical Scroll Navigation -->
        <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 4px;">
            <button class="fms-btn-grey fms-btn-scroll" id="btn-step-scroll-down" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▼▼</button>
            <button class="fms-btn-grey fms-btn-scroll" id="btn-step-scroll-up" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▲▲</button>
        </div>

        <!-- Max SR/Turb Point Box -->
        <div style="border: 1.5px solid #2f3542; border-radius: 4px; padding: 10px; position: relative; margin-top: 6px; margin-bottom: 6px; background-color: #12141a; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span style="position: absolute; top: -8px; left: 10px; background-color: var(--fms-screen-bg); padding: 0 6px; font-size: 0.65rem; color: var(--text-gray); font-weight: bold; letter-spacing: 0.5px;">MAX SR/TURB POINT</span>
            <div id="turb-scroll-container" style="display: flex; flex-direction: column; gap: 6px; font-size: 0.72rem; font-weight: bold; max-height: 80px; overflow-y: auto; padding-right: 4px; flex-grow: 1; scroll-behavior: smooth;">
                ${zonesHTML}
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; flex-shrink: 0;">
                <button class="fms-btn-grey fms-btn-scroll" id="btn-turb-scroll-up" style="width: 34px; height: 26px; font-size: 0.6rem; padding: 2px; border: 1.5px solid #ffffff !important;">▲▲</button>
                <button class="fms-btn-grey fms-btn-scroll" id="btn-turb-scroll-down" style="width: 34px; height: 26px; font-size: 0.6rem; padding: 2px; border: 1.5px solid #ffffff !important;">▼▼</button>
            </div>
        </div>

        <!-- Bottom Actions Row -->
        <div class="fms-row" style="margin-top: auto; padding-bottom: 2px; justify-content: flex-start; align-items: flex-end;">
            <button class="msg-btn btn-return" id="btn-return" style="height: 28px; width: 55px; font-size: 0.68rem; padding: 2px; border: 1.5px solid #ffffff !important;">RETURN</button>
        </div>
    `;
    updateStepAltsTableOnly();
}

// --- Event Listeners (Delegated) ---
// Persist any edit in a data-field input back into flightData,
// so values survive page switches and re-renders.
document.body.addEventListener('input', (e) => {
    const field = e.target.dataset?.field;
    if (field && field in flightData) {
        flightData[field] = e.target.value;
        
        // Recalculate weights if zfw, fob, taxi, trip, final, or altnTime is updated
        if (['zfw', 'fob', 'taxi', 'trip', 'final', 'altnFuel', 'altnTime'].includes(field)) {
            recalculateWeights();
            
            // Dynamically update read-only labels on the screen if elements exist
            const towEl = document.getElementById('tow-display-val');
            if (towEl) towEl.textContent = flightData.tow;
            
            const lwEl = document.getElementById('lw-display-val');
            if (lwEl) lwEl.textContent = flightData.lw;
            
            const destEfobEl = document.getElementById('dest-efob-val');
            if (destEfobEl) destEfobEl.textContent = getDestEfob();
            
            const altnEfobEl = document.getElementById('altn-efob-val');
            if (altnEfobEl) altnEfobEl.textContent = getAltnEfob();
            
            const extraFuelEl = document.getElementById('extra-fuel-val');
            if (extraFuelEl) extraFuelEl.textContent = getExtraFuel();
            
            const destMinFuelEl = document.getElementById('dest-min-fuel-val');
            if (destMinFuelEl) destMinFuelEl.textContent = getDestMinFuel();
            
            const altnUtcEl = document.getElementById('altn-utc-val');
            if (altnUtcEl) altnUtcEl.textContent = getAltnUtc();
        }
        
        // Update comparison debug panel
        updateDebugPanel();
    }
});

document.body.addEventListener('click', (e) => {
    // IMPORT button click is now handled natively via <label> for attribute

    // Top nav INIT button
    if (e.target.closest('#btn-init')) {
        renderInitPage();
    }

    // Top nav MEMO button
    if (e.target.closest('#btn-data')) {
        renderMemoPage();
    }

    // MEMO: NOTEPAD/DRAWPAD 탭 전환
    if (e.target.closest('#tab-memo-notepad')) {
        activeMemoTab = 'NOTEPAD';
        renderMemoPage();
    }
    if (e.target.closest('#tab-memo-drawpad')) {
        activeMemoTab = 'DRAWPAD';
        renderMemoPage();
    }

    // MEMO: 페이지 이동/추가
    if (e.target.closest('#btn-memo-page-prev')) {
        if (activeMemoTab === 'NOTEPAD') {
            if (memoNotepadPageIndex > 0) memoNotepadPageIndex--;
        } else if (memoDrawpadPageIndex > 0) {
            memoDrawpadPageIndex--;
        }
        renderMemoPage();
    }
    if (e.target.closest('#btn-memo-page-next')) {
        if (activeMemoTab === 'NOTEPAD') {
            if (memoNotepadPageIndex < memoNotepadPages.length - 1) memoNotepadPageIndex++;
        } else if (memoDrawpadPageIndex < memoDrawpadPages.length - 1) {
            memoDrawpadPageIndex++;
        }
        renderMemoPage();
    }
    if (e.target.closest('#btn-memo-page-new')) {
        if (activeMemoTab === 'NOTEPAD') {
            memoNotepadPages.push('');
            memoNotepadPageIndex = memoNotepadPages.length - 1;
            saveMemoNotepadPages();
        } else {
            memoDrawpadPages.push(null);
            memoDrawpadPageIndex = memoDrawpadPages.length - 1;
            saveMemoDrawpadPages();
        }
        renderMemoPage();
    }

    // MEMO DRAWPAD: 색상/펜/지우개/전체삭제
    const colorSwatch = e.target.closest('.memo-color-swatch');
    if (colorSwatch) {
        memoDrawColor = colorSwatch.dataset.color;
        memoIsErasing = false;
        renderMemoPage();
    }
    if (e.target.closest('#btn-memo-pen-thin')) {
        memoDrawSize = 2;
        memoIsErasing = false;
    }
    if (e.target.closest('#btn-memo-pen-thick')) {
        memoDrawSize = 6;
        memoIsErasing = false;
    }
    if (e.target.closest('#btn-memo-eraser')) {
        memoIsErasing = true;
        renderMemoPage();
    }
    if (e.target.closest('#btn-memo-clear')) {
        const canvas = document.getElementById('memo-canvas');
        if (canvas) {
            canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
            memoDrawpadPages[memoDrawpadPageIndex] = null;
            saveMemoDrawpadPages();
        }
    }

    // MEMO NOTEPAD: 현재 페이지 전체 삭제
    if (e.target.closest('#btn-memo-notepad-clear')) {
        memoNotepadPages[memoNotepadPageIndex] = '';
        saveMemoNotepadPages();
        const ta = document.getElementById('memo-textarea');
        if (ta) ta.value = '';
    }
    
    // FUEL&LOAD trigger from INIT page
    if (e.target.closest('.btn-fuel-load-trigger')) {
        renderFuelLoadPage();
    }

    // RTE SUMMARY trigger from INIT page
    if (e.target.closest('.rte-summary-aligned-btn')) {
        renderRteSummaryPage();
    }

    // RETURN button
    if (e.target.closest('#btn-return')) {
        resetTitleBar();
        activeMelCdlTab = 'MEL';
        activeDepArrWxTab = 'DEP';
        activeDepArrNotamTab = 'DEP';
        activeEnrteNotamTab = 'ALTN';
        activeEnrteWxTab = 'ALTN';
        activeRteSummaryTab = 'PRIMARY';
        altnRteScrollIndex = 0;
        activeMemoTab = 'NOTEPAD';
        depArrNotamScrollIndex = 0;
        enrteNotamScrollIndex = 0;
        renderInitPage();
    }

    // MEL/CDL trigger from INIT page
    if (e.target.closest('.btn-mel-cdl-trigger')) {
        renderMelCdlPage();
    }

    // DEP/ARR WX trigger from INIT page
    if (e.target.closest('.btn-dep-arr-wx-trigger')) {
        fetchMetar().then(() => renderDepArrWxPage());
        return;
    }

    // DEP/ARR NOTAM trigger from INIT page
    if (e.target.closest('.btn-dep-arr-notam-trigger')) {
        activeDepArrNotamTab = 'DEP';
        depArrNotamScrollIndex = 0;
        renderDepArrNotamPage();
    }

    // ENRTE NOTAM trigger from INIT page
    if (e.target.closest('.btn-enrte-notam-trigger')) {
        activeEnrteNotamTab = 'ALTN';
        enrteNotamScrollIndex = 0;
        renderEnrteNotamPage();
    }

    // ERA/FIR NOTAM trigger from INIT page
    if (e.target.closest('.btn-era-fir-notam-trigger')) {
        activeEraFirNotamTab = 'ERA';
        eraFirNotamScrollIndex = 0;
        renderEraFirNotamPage();
    }

    // ENRTE WX trigger from INIT page
    if (e.target.closest('.btn-enrte-wx-trigger')) {
        renderEnrteWxPage();
    }

    // STEP ALTs trigger from INIT page
    if (e.target.closest('.btn-step-alts-trigger')) {
        renderStepAltsPage();
    }

    // Scroll down click for MEL/CDL Table
    if (e.target.closest('#btn-mel-scroll-down')) {
        const maxScroll = Math.max(0, melCdlData.length - 13);
        if (melCdlScrollIndex < maxScroll) {
            melCdlScrollIndex++;
            updateMelTableOnly();
        }
    }
    
    // Scroll up click for MEL/CDL Table
    if (e.target.closest('#btn-mel-scroll-up')) {
        if (melCdlScrollIndex > 0) {
            melCdlScrollIndex--;
            updateMelTableOnly();
        }
    }

    // Scroll down click for DEP WX Table
    if (e.target.closest('#btn-dep-wx-scroll-down')) {
        const maxScroll = Math.max(0, depArrWxData.length - 13);
        depArrWxScrollIndex = Math.min(depArrWxScrollIndex + 13, maxScroll);
        const tbody = document.querySelector('.mel-cdl-table tbody');
        if (tbody) tbody.innerHTML = getDepArrWxTableHTML();
    }

    // Scroll up click for DEP WX Table
    if (e.target.closest('#btn-dep-wx-scroll-up')) {
        if (depArrWxScrollIndex > 0) {
            depArrWxScrollIndex = Math.max(0, depArrWxScrollIndex - 13);
            const tbody = document.querySelector('.mel-cdl-table tbody');
            if (tbody) tbody.innerHTML = getDepArrWxTableHTML();
        }
    }

    // Scroll down click for ENRTE WX Table
    if (e.target.closest('#btn-enrte-wx-scroll-down')) {
        const currentData = getProcessedEnrteWxData();
        const maxScroll = Math.max(0, currentData.length - 13);
        enrteWxScrollIndex = Math.min(enrteWxScrollIndex + 13, maxScroll);
        const tbody = document.querySelector('.mel-cdl-table tbody');
        if (tbody) tbody.innerHTML = getEnrteWxTableHTML();
    }

    // Scroll up click for ENRTE WX Table
    if (e.target.closest('#btn-enrte-wx-scroll-up')) {
        if (enrteWxScrollIndex > 0) {
            enrteWxScrollIndex = Math.max(0, enrteWxScrollIndex - 13);
            const tbody = document.querySelector('.mel-cdl-table tbody');
            if (tbody) tbody.innerHTML = getEnrteWxTableHTML();
        }
    }

    // Toggle ACTIVE MEL/CDL tab
    if (e.target.closest('#tab-mel-active')) {
        activeMelCdlTab = 'MEL';
        renderMelCdlPage();
    }

    // Toggle CREW DEFER tab
    if (e.target.closest('#tab-crew-defer')) {
        activeMelCdlTab = 'CREW';
        renderMelCdlPage();
    }

    // Toggle DEP/ARR WX tab
    if (e.target.closest('#tab-dep-arr-wx-active')) {
        activeDepArrWxTab = 'DEP';
        renderDepArrWxPage();
    }

    // Toggle DEP/ARR WX Crew Defer tab
    if (e.target.closest('#tab-dep-arr-wx-crew')) {
        activeDepArrWxTab = 'ARR';
        renderDepArrWxPage();
    }

    // Toggle DEP NOTAM tab
    if (e.target.closest('#tab-dep-notam-active')) {
        activeDepArrNotamTab = 'DEP';
        depArrNotamScrollIndex = 0;
        renderDepArrNotamPage();
    }

    // Toggle ARR NOTAM tab
    if (e.target.closest('#tab-arr-notam')) {
        activeDepArrNotamTab = 'ARR';
        depArrNotamScrollIndex = 0;
        renderDepArrNotamPage();
    }

    // Toggle ALTN NOTAM tab
    if (e.target.closest('#tab-enrte-notam-altn')) {
        activeEnrteNotamTab = 'ALTN';
        enrteNotamScrollIndex = 0;
        renderEnrteNotamPage();
    }

    // Toggle EDTO NOTAM tab
    if (e.target.closest('#tab-enrte-notam-era')) {
        activeEnrteNotamTab = 'ERA';
        enrteNotamScrollIndex = 0;
        renderEnrteNotamPage();
    }

    // Toggle ERA NOTAM tab (ERA/FIR NOTAM page)
    if (e.target.closest('#tab-era-fir-notam-era')) {
        activeEraFirNotamTab = 'ERA';
        eraFirNotamScrollIndex = 0;
        renderEraFirNotamPage();
    }

    // Toggle FIR NOTAM tab (ERA/FIR NOTAM page)
    if (e.target.closest('#tab-era-fir-notam-fir')) {
        activeEraFirNotamTab = 'FIR';
        eraFirNotamScrollIndex = 0;
        renderEraFirNotamPage();
    }

    // Scroll ERA/FIR NOTAM table
    if (e.target.closest('#btn-era-fir-notam-scroll-down')) {
        const firLines = activeEraFirNotamTab === 'FIR'
            ? buildFirNotamDisplayLines().length
            : 0;
        const max = Math.max(0, firLines - 13);
        eraFirNotamScrollIndex = Math.min(eraFirNotamScrollIndex + 13, max);
        const tbody = document.querySelector('#era-fir-notam-table-body');
        if (tbody) tbody.innerHTML = getEraFirNotamTableHTML();
    }
    if (e.target.closest('#btn-era-fir-notam-scroll-up')) {
        if (eraFirNotamScrollIndex > 0) {
            eraFirNotamScrollIndex = Math.max(0, eraFirNotamScrollIndex - 13);
            const tbody = document.querySelector('#era-fir-notam-table-body');
            if (tbody) tbody.innerHTML = getEraFirNotamTableHTML();
        }
    }

    // Scroll DEP/ARR NOTAM table — reuse getDepArrNotamTableHTML for line count
    if (e.target.closest('#btn-dep-notam-scroll-down')) {
        const allLines = getDepArrNotamTableHTML.__lines || [];
        // Build lines the same way getDepArrNotamTableHTML does to get the count
        const pdfLoaded = !!lastImportedPdfData;
        let countLines;
        if (activeDepArrNotamTab === 'DEP') {
            countLines = flightData.depNotamEntries?.length
                ? buildNotamDisplayLines(flightData.depNotamEntries, flightData.from || 'RKSI', flightData.depRunwayInfo)
                : [];
        } else {
            countLines = flightData.arrNotamEntries?.length
                ? buildNotamDisplayLines(flightData.arrNotamEntries, flightData.to || 'KJFK', flightData.arrRunwayInfo)
                : [];
        }
        const max = Math.max(0, countLines.length - 13);
        depArrNotamScrollIndex = Math.min(depArrNotamScrollIndex + 13, max);
        const tbody = document.querySelector('#dep-arr-notam-table-body');
        if (tbody) tbody.innerHTML = getDepArrNotamTableHTML();
    }
    if (e.target.closest('#btn-dep-notam-scroll-up')) {
        if (depArrNotamScrollIndex > 0) {
            depArrNotamScrollIndex = Math.max(0, depArrNotamScrollIndex - 13);
            const tbody = document.querySelector('#dep-arr-notam-table-body');
            if (tbody) tbody.innerHTML = getDepArrNotamTableHTML();
        }
    }

    // Scroll ENRTE NOTAM table
    if (e.target.closest('#btn-enrte-notam-scroll-down')) {
        const countLines = activeEnrteNotamTab === 'ALTN'
            ? (flightData.altnNotamEntries?.length
                ? buildNotamDisplayLines(flightData.altnNotamEntries, flightData.altn || 'KPHL', flightData.altnRunwayInfo)
                : [])
            : [];
        const max = Math.max(0, countLines.length - 13);
        enrteNotamScrollIndex = Math.min(enrteNotamScrollIndex + 13, max);
        const tbody = document.querySelector('#enrte-notam-table-body');
        if (tbody) tbody.innerHTML = getEnrteNotamTableHTML();
    }
    if (e.target.closest('#btn-enrte-notam-scroll-up')) {
        if (enrteNotamScrollIndex > 0) {
            enrteNotamScrollIndex = Math.max(0, enrteNotamScrollIndex - 13);
            const tbody = document.querySelector('#enrte-notam-table-body');
            if (tbody) tbody.innerHTML = getEnrteNotamTableHTML();
        }
    }

    // Toggle ENRTE WX tab (ALTN WX)
    if (e.target.closest('#tab-enrte-wx-active')) {
        activeEnrteWxTab = 'ALTN';
        enrteWxScrollIndex = 0;
        renderEnrteWxPage();
    }

    // Toggle ENRTE WX Crew Defer tab (ERA WX)
    if (e.target.closest('#tab-enrte-wx-crew')) {
        activeEnrteWxTab = 'ERA';
        enrteWxScrollIndex = 0;
        renderEnrteWxPage();
    }

    // Toggle PRIMARY/ALTERNATE RTEs tab
    if (e.target.closest('#tab-rte-primary')) {
        activeRteSummaryTab = 'PRIMARY';
        renderRteSummaryPage();
    }
    if (e.target.closest('#tab-rte-alternate')) {
        activeRteSummaryTab = 'ALTERNATE';
        altnRteScrollIndex = 0;
        renderRteSummaryPage();
    }

    // Scroll down click for Route Summary Table — PRIMARY는 1행씩, ALTERNATE는 한 페이지(13행)씩
    if (e.target.closest('#btn-route-scroll-down')) {
        if (activeRteSummaryTab === 'PRIMARY') {
            const maxScroll = Math.max(0, Math.ceil(routeData.length / 2) - 13);
            if (routeScrollIndex < maxScroll) {
                routeScrollIndex++;
                updateRteTableOnly();
            }
        } else {
            const totalRows = buildAltnRteRows().length;
            const maxScroll = Math.max(0, totalRows - 13);
            if (altnRteScrollIndex < maxScroll) {
                altnRteScrollIndex = Math.min(altnRteScrollIndex + 13, maxScroll);
                updateRteTableOnly();
            }
        }
    }

    // Scroll up click for Route Summary Table — PRIMARY는 1행씩, ALTERNATE는 한 페이지(13행)씩
    if (e.target.closest('#btn-route-scroll-up')) {
        if (activeRteSummaryTab === 'PRIMARY') {
            if (routeScrollIndex > 0) {
                routeScrollIndex--;
                updateRteTableOnly();
            }
        } else {
            if (altnRteScrollIndex > 0) {
                altnRteScrollIndex = Math.max(0, altnRteScrollIndex - 13);
                updateRteTableOnly();
            }
        }
    }

    // Scroll down click for Step Alts Table
    if (e.target.closest('#btn-step-scroll-down')) {
        const maxScroll = Math.max(0, stepAltData.length - 5);
        if (stepAltScrollIndex < maxScroll) {
            stepAltScrollIndex++;
            updateStepAltsTableOnly();
        }
    }
    
    // Scroll up click for Step Alts Table
    if (e.target.closest('#btn-step-scroll-up')) {
        if (stepAltScrollIndex > 0) {
            stepAltScrollIndex--;
            updateStepAltsTableOnly();
        }
    }

    // Scroll up click for Turbulence Point Container
    if (e.target.closest('#btn-turb-scroll-up')) {
        const container = document.getElementById('turb-scroll-container');
        if (container) {
            container.scrollTop -= 24;
        }
    }

    // Scroll down click for Turbulence Point Container
    if (e.target.closest('#btn-turb-scroll-down')) {
        const container = document.getElementById('turb-scroll-container');
        if (container) {
            container.scrollTop += 24;
        }
    }

});

// --- Hold-to-scroll: press and hold any scroll button to keep paging ---
let _scrollHoldTimer = null;
let _scrollHoldInterval = null;

function _clearScrollHold() {
    clearTimeout(_scrollHoldTimer);
    clearInterval(_scrollHoldInterval);
    _scrollHoldTimer = null;
    _scrollHoldInterval = null;
}

document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.fms-btn-scroll');
    if (!btn) return;
    _scrollHoldTimer = setTimeout(() => {
        _scrollHoldInterval = setInterval(() => btn.click(), 200);
    }, 500);
});

document.addEventListener('pointerup', _clearScrollHold);
document.addEventListener('pointercancel', _clearScrollHold);
document.addEventListener('pointerleave', _clearScrollHold);

// --- Initial Render ---
renderInitPage();

// --- PDF Import and Parsing Logic ---
// FMS-style amber alert popup shown when PDF import/parsing fails.
function showFailAlert(reason) {
    // Remove any existing alert first
    document.getElementById('import-fail-alert')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'import-fail-alert';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(0,0,0,0.65);
        display: flex; justify-content: center; align-items: center;
    `;

    const detail = (reason && reason.message) ? reason.message : String(reason || '');

    overlay.innerHTML = `
        <div style="
            background: #12141a; border: 2px solid #ffbf00; border-radius: 6px;
            width: min(420px, 86vw); padding: 22px 24px;
            font-family: 'Share Tech Mono', 'Courier Prime', monospace;
            box-shadow: 0 0 30px rgba(255,191,0,0.25);
        ">
            <div style="color: #ffbf00; font-size: 1.05rem; font-weight: bold; letter-spacing: 1px; margin-bottom: 12px;">
                ⚠ PDF IMPORT FAILED
            </div>
            <div style="color: #e2e8f0; font-size: 0.85rem; line-height: 1.55; margin-bottom: 6px;">
                OFP 데이터를 읽지 못했습니다.<br>
                아래 사항을 확인해 주세요:
            </div>
            <ul style="color: #a0aec0; font-size: 0.78rem; line-height: 1.6; margin: 0 0 14px 18px; padding: 0;">
                <li>Aviator에서 내보낸 OFP PDF가 맞는지</li>
                <li>텍스트 기반 PDF인지 (스캔 이미지 불가)</li>
                <li>인터넷 연결 상태 (PDF 엔진 로딩에 필요)</li>
            </ul>
            <div style="color: #718096; font-size: 0.68rem; margin-bottom: 16px; word-break: break-all;">
                ${detail ? 'DETAIL: ' + detail : ''}
            </div>
            <div style="text-align: right;">
                <button id="import-fail-ok" style="
                    background: #1e2230; border: 1.5px solid #ffbf00; border-radius: 4px;
                    color: #ffbf00; font-family: inherit; font-size: 0.85rem; font-weight: bold;
                    padding: 7px 28px; cursor: pointer; letter-spacing: 1px;
                ">OK</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#import-fail-ok').addEventListener('click', close);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
}

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
}

const fileInputEl = document.getElementById('pdf-file-input');
if (fileInputEl) {
    fileInputEl.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

    const pageTitle = document.getElementById('page-title-text');
    if (pageTitle) {
        pageTitle.innerHTML = `<span style="color: var(--text-cyan);">IMPORTING PDF...</span>`;
    }

    const progressContainer = document.querySelector('.fms-progress-container');
    const fillEl = document.querySelector('.progress-bar-fill');
    const percentEl = document.querySelector('.progress-percent');

    if (progressContainer && fillEl && percentEl) {
        progressContainer.style.display = 'flex';
        fillEl.style.width = '5%';
        percentEl.textContent = '5%';
    }

    const setProgress = (pct) => {
        if (fillEl && percentEl) {
            fillEl.style.width = pct + '%';
            percentEl.textContent = pct + '%';
        }
    };

    // Show a clear, unambiguous failure state.
    // NOTE: This is a flight-prep aid. Never show fake "success" data —
    // wrong data that looks real is worse than no data.
    const showImportFailed = (reason) => {
        console.error('PDF import failed:', reason);
        setProgress(100);
        if (pageTitle) {
            pageTitle.innerHTML = `<span style="color: #ffbf00;">IMPORT FAILED — CHECK PDF</span>`;
        }
        showFailAlert(reason);
        setTimeout(() => {
            if (progressContainer) progressContainer.style.display = 'none';
            if (pageTitle) pageTitle.textContent = 'ACTIVE/INIT';
        }, 2500);
    };

    try {
        if (typeof pdfjsLib === 'undefined') {
            showImportFailed('pdf.js library not loaded (offline or CDN blocked)');
            return;
        }

        const arrayBuffer = await file.arrayBuffer();
        setProgress(20);

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        setProgress(40);

        resetFlightData(); // Clear old data before parsing new PDF

        let fullText = '';
        const numPages = pdf.numPages;

        for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = getPageTextWithNewlines(textContent);
            fullText += pageText + '\n';
            setProgress(Math.round(40 + (i / numPages) * 45));
        }

        setProgress(90);

        // --- Extract values: patterns match the Asiana CFP (OFP page 1) format. ---
        // Fuel figures on the CFP are in 100 LBS units; convert to klbs (e.g. 0092 -> 9.2).
        const toKlbs = (s) => (parseInt(s, 10) / 10).toFixed(1);
        let matchedCount = 0;

        // 1. FLT NBR — "FLIGHT RELEASE AAR201"
        const fltMatch = fullText.match(/FLIGHT\s+RELEASE\s+([A-Z]{2,3}\d{1,4}[A-Z]?)/i) ||
                         fullText.match(/(?:FLT|FLIGHT)\s*(?:NBR|NO|NUMBER)?\s*[:\-#]?\s*([A-Z]{2,3}\d{1,4})/i);
        if (fltMatch) { flightData.fltNbr = fltMatch[1].toUpperCase(); matchedCount++; }

        // 2. FROM/TO — "KLAX/RKSI ON 08/JUN/26"
        const routeMatch = fullText.match(/\b([A-Z]{4})\/([A-Z]{4})\s+ON\b/i) ||
                           fullText.match(/\b([A-Z]{4})\s*(?:\/|→|->)\s*([A-Z]{4})\b/);
        if (routeMatch) {
            flightData.from = routeMatch[1].toUpperCase();
            flightData.to = routeMatch[2].toUpperCase();
            matchedCount++;
        }

        // 3. ALTN — "ALTN/RKSS 0092 00.17"  (also captures ALTN fuel and time)
        const altnMatch = fullText.match(/ALTN\s*\/\s*([A-Z]{4})\s+(\d{3,5})\s+(\d{2})\s*[:\.]\s*(\d{2})/i) ||
                          fullText.match(/ALTN\s*\/\s*([A-Z]{4})\s+(\d{3,5})/i) ||
                          fullText.match(/(?:ALTN|ALTERNATE)\s*[:\/\-]?\s*([A-Z]{4})\b/i);
        if (altnMatch) {
            flightData.altn = altnMatch[1].toUpperCase();
            if (altnMatch[2]) flightData.altnFuel = toKlbs(altnMatch[2]);
            if (altnMatch[3] && altnMatch[4]) flightData.altnTime = altnMatch[3] + ':' + altnMatch[4];
            matchedCount++;
        }

        // 3b. FINAL RES — "FINAL RES   0110  00.30"
        const finalMatch = fullText.match(/FINAL\s+RES\s+(\d{3,5})\s+(\d{2})\s*[:\.]\s*(\d{2})/i) ||
                           fullText.match(/FINAL\s*[:\-]?\s*(\d{3,5})\s+(\d{2})\s*[:\.]\s*(\d{2})/i);
        if (finalMatch) {
            flightData.final = toKlbs(finalMatch[1]);
            flightData.finalTime = finalMatch[2] + ':' + finalMatch[3];
            matchedCount++;
        }

        // 4. CI — "CRZ- 65" on the SPEED SKD line (FMS Cost Index)
        const ciMatch = fullText.match(/CRZ-\s*(\d{1,3})\b/i) ||
                        fullText.match(/(?:\bCI\b|COST\s*INDEX)\s*[:\-]?\s*(\d{1,3})\b/i);
        if (ciMatch) { flightData.ci = ciMatch[1]; matchedCount++; }

        // 5. CRZ FL — company rule: 2ND-$ flight level + 2000 ft
        //    "2ND-$ 280 4031 13.13" -> FL280 + 20 -> FL 300
        const secondPlanMatch = fullText.match(/2ND-\$\s+(\d{3})\b/i);
        if (secondPlanMatch) {
            flightData.crzFl = 'FL ' + (parseInt(secondPlanMatch[1], 10) + 20);
            matchedCount++;
        } else {
            const flMatch = fullText.match(/CRZ\s*FL\s*[:\-]?\s*(\d{3})\b/i);
            if (flMatch) { flightData.crzFl = 'FL ' + flMatch[1]; matchedCount++; }
        }

        // 6. AVG WIND/TEMP header — "P089/M55" → TRIP WIND only
        const windTempMatch = fullText.match(/\b([MP]\d{3})\s*\/\s*([MP]\d{1,2})\b/);
        if (windTempMatch) {
            flightData.tripWind = windTempMatch[1].toUpperCase();
            matchedCount++;
        }

        // 6b. CRZ TEMP — OAT at the waypoint where altitude first transitions CLB → CRZ FL
        //     Route line format: "DDDD  NXX[ ]XX.X  TTT  ALT  WDR/WSP  FUEL  OAT ..."
        //     ALT column is either "CLB" or a 3-digit FL number (e.g. 390).
        //     OAT at cruise altitude is always negative — shown as magnitude only in OFP.
        const crzFlNum = (flightData.crzFl || '').replace(/\D/g, '');
        if (crzFlNum) {
            // Flexible regex: lat may or may not have space between degrees and decimal
            const routeRe = /^\s*\d{4,5}\s+[NS][\d.\s]+\s+\d{2,3}\s+(CLB|\d{3})\s+\S+\/\d+\s+(\d{3,5})\s+(\d{2,3})/gm;
            let rm;
            let prevAlt = 'CLB';
            while ((rm = routeRe.exec(fullText)) !== null) {
                const alt = rm[1];
                const oat = parseInt(rm[3], 10);
                // Target: first line where ALT == CRZ FL (transition from CLB)
                if (alt === crzFlNum) {
                    flightData.crzTemp = '-' + oat + ' °C';
                    matchedCount++;
                    break;
                }
                prevAlt = alt;
            }
        }

        // 7. APMS — "APMS/P 02.3 PCNT" -> "+2.3 %"  (M = minus)
        const apmsMatch = fullText.match(/APMS\s*\/\s*([MP])\s*(\d{1,2}\.\d)\s*PCNT/i);
        if (apmsMatch) {
            const sign = apmsMatch[1].toUpperCase() === 'M' ? '-' : '+';
            flightData.apms = sign + parseFloat(apmsMatch[2]) + ' %';
            matchedCount++;
        }

        // 8. ZFW — "ZFW 07851" (100 lbs) -> 785.1 klbs
        const zfwMatch = fullText.match(/(?<![A-Z])ZFW\s+(\d{4,5})\b/i);
        if (zfwMatch) { flightData.zfw = toKlbs(zfwMatch[1]); matchedCount++; }

        // 9. Fuels — CONT / TAXI / RAMP OUT (all 100 lbs -> klbs)
        const contMatch = fullText.match(/(\d)\s*PCT\s*CONT\s+(\d{4})/i);
        if (contMatch) {
            flightData.rteRsv = toKlbs(contMatch[2]);
            flightData.rteRsvPct = contMatch[1] + '.0 %';
            matchedCount++;
        }
        const taxiMatch = fullText.match(/\bTAXI\s+(\d{4})\b/i);
        if (taxiMatch) { flightData.taxi = toKlbs(taxiMatch[1]); matchedCount++; }

        const rampMatch = fullText.match(/RAMP\s*OUT\s+(\d{4})\b/i);
        if (rampMatch) { flightData.fob = toKlbs(rampMatch[1]); matchedCount++; }

        // 10. TRIP — e.g. "TRIP      03824  13.02" or "TRIP 3824 13:02"
        const tripMatch = fullText.match(/TRIP\s+(\d{3,5})\s+(\d{2})\s*[:\.]\s*(\d{2})\b/i) || 
                          fullText.match(/TRIP\s*FUEL\s*[:\-]?\s*(\d{3,5})\s+(\d{2})\s*[:\.]\s*(\d{2})\b/i);
        if (tripMatch) {
            flightData.trip = toKlbs(tripMatch[1]);
            flightData.tripTime = tripMatch[2] + ':' + tripMatch[3];
            matchedCount++;
        }

        // 11. PAX NBR — e.g. "PASSENGERS:  FIRST 0/0    BUSINESS 73/78    ECONOMY 412/417"
        const paxMatch = fullText.match(/PASSENGERS:\s+FIRST\s+(\d+)\s*\/\s*\d+\s+BUSINESS\s+(\d+)\s*\/\s*\d+\s+ECONOMY\s+(\d+)\s*\/\s*\d+/i) ||
                         fullText.match(/PAX\/BAGS\s+(\d{1,3})\b/i) ||
                         fullText.match(/PAX\s*\/?[#]?\s*(\d{1,3})\b/i);
        if (paxMatch) {
            if (paxMatch[0].toUpperCase().includes('PASSENGERS')) {
                const business = parseInt(paxMatch[1], 10) + parseInt(paxMatch[2], 10); // FIRST는 BUSINESS에 합산
                const economy = parseInt(paxMatch[3], 10);
                // 표시 형식: 비즈니스/이코노미/총원
                flightData.paxNbr = `${business}/${economy}/${business + economy}`;
            } else {
                flightData.paxNbr = paxMatch[1];
            }
            matchedCount++;
        }

        // 11b. CARGO — "CARGO: 7055 LBS" → 톤 변환 (1 ton = 2000 lbs)
        const cargoMatch = fullText.match(/CARGO\s*:\s*(\d+)\s*LBS/i);
        if (cargoMatch) {
            const cargoTons = (parseInt(cargoMatch[1], 10) / 2000).toFixed(1);
            flightData.cargoTons = cargoTons.padStart(4, '0') + ' T';
            matchedCount++;
        }

        // 12. TOW — e.g. "TOW 12139" or "TOW 1213.9"
        const towMatch = fullText.match(/(?<![A-Z])TOW\s+(\d{4,5})\b/i) ||
                         fullText.match(/(?<![A-Z])TOW\s+(\d{3,4}\.\d)\b/i) ||
                         fullText.match(/(?<![A-Z])TOW\s*[:\-]?\s*(\d{4,5})\b/i);
        if (towMatch) {
            flightData.tow = towMatch[1].includes('.') ? parseFloat(towMatch[1]).toFixed(1) : toKlbs(towMatch[1]);
            matchedCount++;
        }

        // 13. LW — e.g. "LW 08315" or "LDW 08315"
        const lwMatch = fullText.match(/(?<![A-Z])(?:LW|LDW|LAW)\s+(\d{4,5})\b/i) ||
                        fullText.match(/(?<![A-Z])(?:LW|LDW|LAW)\s+(\d{3,4}\.\d)\b/i) ||
                        fullText.match(/(?<![A-Z])(?:LW|LDW|LAW)\s*[:\-]?\s*(\d{4,5})\b/i);
        if (lwMatch) {
            flightData.lw = lwMatch[1].includes('.') ? parseFloat(lwMatch[1]).toFixed(1) : toKlbs(lwMatch[1]);
            matchedCount++;
        }

        // 14. FOD (Fuel on Destination) for DEST EFOB
        const fodMatch = fullText.match(/(?<![A-Z])FOD\s+(\d{3,5})\b/i) || 
                         fullText.match(/(?<![A-Z])FOD\s*[A-Z]{4}\s+(\d{3,5})\b/i) ||
                         fullText.match(/(?<![A-Z])FOD\s*\/\s*[A-Z]{4}\s+(\d{3,5})\b/i) ||
                         fullText.match(/(?<![A-Z])FOD\s+(\d{1,3}\.\d)\b/i);
        if (fodMatch) {
            flightData.fod = fodMatch[1].includes('.') ? parseFloat(fodMatch[1]).toFixed(1) : toKlbs(fodMatch[1]);
            matchedCount++;
        }

        // 15. CCF & TANKERING
        const ccfMatch = fullText.match(/\bCCF\s+(\d{3,5})\b/i) ||
                         fullText.match(/\bCCF\s*[:\-]?\s*(\d{3,5})\b/i);
        if (ccfMatch) {
            flightData.ccf = parseInt(ccfMatch[1], 10).toString();
            matchedCount++;
        }

        const tankMatch = fullText.match(/TANK(?:ERING)?\s+(\d{3,5})\b/i) ||
                          fullText.match(/TANKRG\s*[:\-]?\s*(\d{3,5})\b/i);
        if (tankMatch) {
            flightData.tank = parseInt(tankMatch[1], 10).toString();
            matchedCount++;
        }

        // 15b. ROUTE FUEL CONSUMPTION STATISTICS — "MEAN/ 2,033 LBS, 95% STAT/ 6,260 LBS, 99% STAT/ 8,011 LBS"
        // 부호가 본문에 없으면 "TRIP FUEL DIFF (ACTUAL - PLAN)" 기준 양수(+)로 표시
        const fuelStatMatch = fullText.match(/MEAN\/\s*([+\-]?[\d,]+)\s*LBS,\s*95%\s*STAT\/\s*([+\-]?[\d,]+)\s*LBS,\s*99%\s*STAT\/\s*([+\-]?[\d,]+)\s*LBS/i);
        if (fuelStatMatch) {
            const withSign = (s) => {
                const n = parseInt(s.replace(/,/g, ''), 10);
                return (n >= 0 ? '+' : '') + n;
            };
            flightData.fuelStatMean = withSign(fuelStatMatch[1]);
            flightData.fuelStat95 = withSign(fuelStatMatch[2]);
            flightData.fuelStat99 = withSign(fuelStatMatch[3]);
            matchedCount++;
        }

        // 16. ACFT REG (HL Number)
        const regMatch = fullText.match(/\b(HL\d{4})\b/i);
        if (regMatch) {
            flightData.acftReg = regMatch[1].toUpperCase();
            matchedCount++;
        }

        // 17. MEL / CDL items
        const melRegex = /\-\s*(MEL|CDL)\s+([A-Z0-9\-]+)\s*:\s*(.*?)(?=\s*\-\s*(?:MEL|CDL)|\s*\d+\.\s*[A-Z]|$)/gi;
        let m;
        while ((m = melRegex.exec(fullText)) !== null) {
            melCdlData.push({
                type: m[1].toUpperCase(),
                num: m[2],
                desc: m[3].trim()
            });
            matchedCount++;
        }

        // 18. ETD/ETA — "ETD KLAX 1710Z ETA RKSI 0612Z"
        const etdEtaMatch = fullText.match(/ETD\s+[A-Z]{4}\s+(\d{2})(\d{2})Z\s+ETA\s+[A-Z]{4}\s+(\d{2})(\d{2})Z/i);
        if (etdEtaMatch) {
            flightData.etd = etdEtaMatch[1] + ':' + etdEtaMatch[2];
            flightData.eta = etdEtaMatch[3] + ':' + etdEtaMatch[4];
            destUtc = flightData.eta;
            matchedCount++;
        } else {
            const etaMatch = fullText.match(/ETA\s+[A-Z]{4}\s+(\d{2})(\d{2})Z/i);
            if (etaMatch) {
                flightData.eta = etaMatch[1] + ':' + etaMatch[2];
                destUtc = flightData.eta;
                matchedCount++;
            }
        }

        // 19. FLIGHT DAY — "RELEASE THE FLIGHT AAR0201/08JUN"
        const releaseMatch = fullText.match(/RELEASE\s+THE\s+FLIGHT\s+[A-Z]{2,3}\d{1,4}\/(\d{2})[A-Z]{3}\b/i) ||
                             fullText.match(/FLIGHT\s+[A-Z]{2,3}\d{1,4}\/(\d{2})[A-Z]{3}\b/i);
        if (releaseMatch) {
            flightData.flightDay = releaseMatch[1];
            matchedCount++;
        }

        // 20. WEATHER SECTIONS
        flightData.depWeatherRaw = extractWeatherSection(fullText, 'DEPARTURE WEATHER');
        flightData.arrWeatherRaw = extractWeatherSection(fullText, 'ARRIVAL WEATHER');
        flightData.altnWeatherRaw = extractWeatherSection(fullText, 'ALTERNATE WEATHER');
        flightData.enrteWeatherRaw = extractWeatherSection(fullText, 'ENROUTE WEATHER');

        // NOTAM PACKAGE 1, 2 & 3 parsing
        flightData.depNotamEntries  = [];
        flightData.arrNotamEntries  = [];
        flightData.altnNotamEntries = [];
        flightData.etpNotamSections = [];
        flightData.firNotamSections = [];
        flightData.firAiSummary = '';
        flightData.firAiStatus = 'idle';
        extractNotamPackage1(fullText);
        extractNotamPackage2(fullText);
        extractNotamPackage3(fullText);  // FIR NOTAM + AI 요약 트리거

        // 실시간 데이터 fetch (METAR 15분 캐싱, 게이트 편명 기반)
        fetchMetar();
        fetchGate();
        if (flightData.depWeatherRaw.length > 0 || flightData.arrWeatherRaw.length > 0) {
            matchedCount++;
        }

        // 21. FPL ROUTE
        const fplMatch = fullText.match(/\(FPL-[\s\S]*?\)/);
        if (fplMatch) {
            const fplLines = fplMatch[0].split('\n').map(l => l.trim());
            let routeStr = '';
            let inRoute = false;
            for (let i = 0; i < fplLines.length; i++) {
                const line = fplLines[i];
                if (line.match(/^\-[NKM]\d{3,4}[FSAM]\d{3,4}/)) {
                    inRoute = true;
                    routeStr += line + ' ';
                } else if (inRoute) {
                    if (line.startsWith('-')) {
                        break;
                    }
                    routeStr += line + ' ';
                }
            }
            if (routeStr) {
                routeData = parseFlightPlanRoute(routeStr);
                altnRouteData = extractAltnRoute(fullText);
                lolvEtpData = extractLolvEtpData(fullText);
                eraValidationData = extractEraValidationData(fullText);
                refileFltPlanData = extractRefileFltPlanData(fullText);
                atsFplCompareResult = extractAtsFplComparisonResult(fullText);
                const parsedSteps = parseStepAlts(routeStr, flightData.from, fullText);
                stepAltData.length = 0;
                parsedSteps.forEach(step => stepAltData.push(step));
                stepAltScrollIndex = 0;
                
                // Parse all waypoints with SR and ACTM for turbulence zones
                const wptsForTurb = [];
                const coordRe = /^([A-Z0-9]{2,10})\s+[WE]\d{2,3}\s+\d{1,2}\.\d\s+\d{3}\s+\/\s+(?:\d{2,3}|\.\.)\s+(?:\d{3,4}|\.\.\.)\s+(\d{2}\.\d{2})\s+(\d{4})\//;
                const srRe = /\b\d{5}(?:[PM]\d{3}|\s+\d{3})\s+(\d{2})\s+(\d{3})\b/;
                const lines = fullText.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const lineStr = lines[i].trim();
                    // REFILE 섹션/문서 끝 이후로는 메인 루트가 아니므로 중단
                    // (REFILE FLT PLAN, 페이지 88-96 CFP 복사본 모두 이 지점 이후에 위치)
                    if (
                        lineStr.includes('REFILE FLT PLAN') ||
                        lineStr.includes('END OF JEPPESEN') ||
                        lineStr.includes('ROUTE TO ALTN')
                    ) {
                        break;
                    }
                    const matchCoord = lineStr.match(coordRe);
                    if (matchCoord) {
                        const wpt = matchCoord[1];
                        const actm = matchCoord[2];
                        let sr = '00';
                        const prevLine = lines[i - 1] || '';
                        const srMatch = prevLine.match(srRe) || lineStr.match(srRe);
                        if (srMatch) {
                            sr = srMatch[1];
                        }
                        wptsForTurb.push({ wpt, sr, actm });
                    }
                }
                if (wptsForTurb.length > 0) {
                    flightData.turbZones = extractTurbulenceZones(wptsForTurb);
                }
                
                matchedCount++;
            }
        }

        // Fallback calculations for TOW, LW, and FOD if not explicitly parsed from PDF
        if (!towMatch && (zfwMatch || rampMatch || taxiMatch)) {
            flightData.tow = (num(flightData.zfw) + num(flightData.fob) - num(flightData.taxi)).toFixed(1);
        }
        if (!lwMatch) {
            flightData.lw = (num(flightData.tow) - num(flightData.trip)).toFixed(1);
        }
        if (!fodMatch) {
            flightData.fod = (num(flightData.fob) - num(flightData.taxi) - num(flightData.trip)).toFixed(1);
        }

        setProgress(100);

        // Require a minimum number of fields — a random PDF must not look "imported".
        if (matchedCount < 3) {
            showImportFailed('recognized only ' + matchedCount + ' field(s) — not an OFP?');
            return;
        }

        // Save raw parsed data snapshot for debug comparison panel
        lastImportedPdfData = {
            fltNbr: flightData.fltNbr,
            from: flightData.from,
            to: flightData.to,
            altn: flightData.altn,
            crzFl: flightData.crzFl,
            crzTemp: flightData.crzTemp,
            ci: flightData.ci,
            tripWind: flightData.tripWind,
            apms: flightData.apms,
            zfw: flightData.zfw,
            zfwcg: flightData.zfwcg,
            fob: flightData.fob,
            taxi: flightData.taxi,
            paxNbr: flightData.paxNbr,
            trip: flightData.trip,
            tripTime: flightData.tripTime,
            altnFuel: flightData.altnFuel,
            altnTime: flightData.altnTime,
            final: flightData.final,
            finalTime: flightData.finalTime,
            tow: flightData.tow,
            lw: flightData.lw,
            fod: flightData.fod
        };
        updateDebugPanel();

        updateHeaderFltNbr();

        setTimeout(() => {
            if (progressContainer) progressContainer.style.display = 'none';
            renderInitPage();
        }, 1200);

    } catch (err) {
        showImportFailed(err);
    }
});
}

function adjustBezelScale() {
    const bezelWidth = 580; // FMS bezel width
    const bezelHeight = 740; // FMS bezel height
    const padding = 10;
    
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    
    const isLandscape = winW > winH;
    let scale;
    
    if (isLandscape) {
        scale = (winH - padding) / bezelHeight;
    } else {
        scale = (winW - padding) / bezelWidth;
    }
    
    document.body.classList.remove('rotated-landscape');
    
    const minScale = 0.5;
    if (scale < minScale) {
        scale = minScale;
    }
    
    document.body.style.setProperty('--scale', scale);
}

// iOS PWA는 백그라운드 복귀 직후 innerWidth/Height가 안정화 전이라 1회 계산 시
// 화면이 작게 잡히는 고질 버그가 있음 → 즉시 + 지연 여러 번 재계산해 보정.
function scheduleBezelScale() {
    adjustBezelScale();
    setTimeout(adjustBezelScale, 100);
    setTimeout(adjustBezelScale, 300);
    setTimeout(adjustBezelScale, 600);
}

// Attach listeners for scaling and panels
window.addEventListener('resize', adjustBezelScale);
window.addEventListener('orientationchange', scheduleBezelScale);
window.addEventListener('pageshow', scheduleBezelScale);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        scheduleBezelScale();
    }
});
// 키보드 노출/축소 등 visual viewport 변화에도 대응 (iOS)
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', adjustBezelScale);
}
window.addEventListener('DOMContentLoaded', () => {
    scheduleBezelScale();
    updateDebugPanel();
});
scheduleBezelScale();
updateDebugPanel();
setTimeout(adjustBezelScale, 1500);
