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
    fod: ''
};

// Keep track of raw values parsed from PDF
let lastImportedPdfData = null;

function resetFlightData() {
    for (let key in flightData) {
        if (key === 'mode') flightData[key] = 'ECON';
        else if (key === 'tropo') flightData[key] = '36090 FT';
        else flightData[key] = '';
    }
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
const routeData = [
    { airway: 'SUMMR2', waypoint: 'SCTRR' },
    { airway: 'DIR', waypoint: 'SNS' },
    { airway: 'DIR', waypoint: 'OAK' },
    { airway: 'J3', waypoint: 'RBL' },
    { airway: 'DIR', waypoint: 'UBG' },
    { airway: 'DIR', waypoint: 'ARRIE' },
    { airway: 'DIR', waypoint: 'GOVAD' },
    { airway: 'DIR', waypoint: 'KATCH' },
    { airway: 'B757', waypoint: 'CJAYY' },
    { airway: 'DIR', waypoint: 'N58W160' },
    { airway: 'DIR', waypoint: 'N57W170' },
    { airway: 'DIR', waypoint: 'N55E180' },
    { airway: 'DIR', waypoint: 'OPAKE' },
    { airway: 'A342', waypoint: 'NUZAN' },
    { airway: 'R220', waypoint: 'NODAN' },
    { airway: 'R217', waypoint: 'ASTER' },
    { airway: 'Y514', waypoint: 'SDE' },
    { airway: 'Y512', waypoint: 'GTC' },
    { airway: 'Y142', waypoint: 'SAMON' },
    { airway: 'Y14', waypoint: 'SUGNO' },
    { airway: 'Y16', waypoint: 'SAPRA' },
    { airway: 'Y685', waypoint: 'GUKDO' },
    { airway: 'DIR', waypoint: 'RKSI' }
];

// --- Step Altitude Transition Data ---
const stepAltData = [
    { wpt: 'KLAX', alt: 'FL300', dist: '', time: '' },
    { wpt: 'RBL', alt: 'FL340', dist: '211 NM', time: '00:45' },
    { wpt: 'N55E180', alt: 'FL360', dist: '2360 NM', time: '04:55' },
    { wpt: 'OPAKE', alt: 'FL380', dist: '3124 NM', time: '06:20' },
    { wpt: 'NUZAN', alt: 'FL390', dist: '3561 NM', time: '07:15' },
    { wpt: 'NOGAL', alt: 'FL400', dist: '4120 NM', time: '08:35' },
    { wpt: 'SAMON', alt: 'FL380', dist: '4980 NM', time: '10:20' }
];
let stepAltScrollIndex = 0;

// --- MEL/CDL Data ---
let melCdlScrollIndex = 0;
let activeMelCdlTab = 'MEL'; // 'MEL' or 'CREW'
const melCdlData = [
    { type: 'MEL', num: '33-20-10A', desc: 'LU43 (UL2) SIDE CEILING LIGHT OUT' },
    { type: 'MEL', num: '50-10-05A', desc: 'FWD CGO ANTI ROLL OUT LATCH DAMAGED(5085' },
    { type: 'CDL', num: '27-22', desc: 'R/H OUTER FLAP-OUTER END SEAL PARTIALLY' }
];

// --- Weather Data ---
let depArrWxScrollIndex = 0;
let activeDepArrWxTab = 'DEP'; // 'DEP' or 'ARR'
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
                        <span class="text-green-fms">CCF : 800 LBS</span> in DISC FUEL<br>
                        <span style="font-size: 0.75rem; color: var(--text-gray);">(DUE TO ENROUTE CB/TS, TURB)</span><br>
                        <span class="text-green-fms">TANKRG : 000 LBS</span>
                    </div>
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
                    <div class="fms-val-box extracted-value">
                        <input type="text" value="${flightData.fltNbr}" id="input-flt-nbr">
                    </div>
                </div>
                <div class="cell-right" style="gap: 10px;">
                    <button class="fms-btn-grey acft-status-btn" style="border-color: var(--text-green); color: var(--text-green);">APMS ${flightData.apms.replace(' %', '')}</button>
                    <label for="pdf-file-input" class="fms-btn-grey cpny-request-btn" style="border-color: var(--text-cyan); color: var(--text-cyan); font-size: 0.9rem; font-weight: bold; display: flex; justify-content: center; align-items: center; cursor: pointer; box-sizing: border-box;">IMPORT</label>
                </div>
            </div>
        </div>

        <!-- Row 2: FROM TO ALTN -->
        <div class="fms-row">
            <div class="fms-cell" style="justify-content: flex-start; gap: 8px;">
                <span class="fms-label">FROM</span>
                <div class="fms-val-box extracted-value airport-box">
                    <input type="text" value="${flightData.from}" data-field="from">
                </div>
                <span style="color: var(--text-white); font-weight: bold; font-size: 0.95rem; margin: 0 4px;">TO</span>
                <div class="fms-val-box extracted-value airport-box">
                    <input type="text" value="${flightData.to}" data-field="to">
                </div>
                <span style="color: var(--text-white); font-weight: bold; font-size: 0.95rem; margin: 0 4px;">ALTN</span>
                <div class="fms-val-box extracted-value altn-airport-box">
                    <input type="text" value="${flightData.altn}" data-field="altn">
                </div>
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
            </div>
            <div class="bottom-aligned-row">
                <button class="fms-btn-grey align-target-btn btn-dep-arr-wx-trigger" style="border-color: #ffffff; color: #ffffff;">DEP/ARR WX</button>
                <button class="fms-btn-grey rte-summary-aligned-btn" style="border-color: #ffffff; color: #ffffff;">RTE SUMMARY</button>
            </div>
            <div class="bottom-aligned-row">
                <button class="fms-btn-grey align-target-btn btn-enrte-wx-trigger" style="border-color: #ffffff; color: #ffffff;">ENRTE WX</button>
            </div>
            <div class="bottom-aligned-row">
                <button class="fms-btn-grey align-target-btn btn-fuel-load-trigger" style="border-color: #ffffff; color: #ffffff;">FUEL&LOAD</button>
            </div>
            <div class="bottom-aligned-row">
                <button class="fms-btn-grey align-target-btn btn-step-alts-trigger" style="border-color: #ffffff; color: #ffffff;">STEP ALT</button>
                <button class="fms-btn-grey cpny-to-aligned-btn" style="border: none; color: #ffffff;">CREW/CABIN BRIEFING</button>
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
        tbody.innerHTML = getRteSummaryTableHTML();
    }
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
                <button class="fms-btn-grey" id="btn-mel-scroll-down" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▼▼</button>
                <button class="fms-btn-grey" id="btn-mel-scroll-up" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▲▲</button>
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
    const rawData = activeEnrteWxTab === 'ALTN' ? alternateWxData : enrouteWxDataList;
    const tafData = [];
    for (let i = 0; i < rawData.length; i++) {
        const item = rawData[i];
        if (item.text.startsWith('TAF') && i > 0) {
            tafData.push({ isBlank: true });
        }
        tafData.push(item);
    }
    return tafData;
}

function getDepArrWxTableHTML() {
    let html = '';
    const tafData = activeDepArrWxTab === 'DEP' ? klaxTafData : rksiTafData;

    for (let i = 0; i < 13; i++) {
        const item = tafData[i];
        if (!item) {
            html += `
                <tr style="height: 24px;">
                    <td style="padding: 2px 4px;"></td>
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
                        <span>AAR201</span><span class="arrow-down">▼</span>
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
                <span class="text-green-fms" style="font-weight: bold; margin-right: 15px;">${isDepActive ? '1710Z' : '0612Z'}</span>
                <span class="text-white-fms">LOCAL</span>
                <span style="color: var(--text-green); font-weight: bold;">${isDepActive ? '10:10 L' : '15:12 L'}</span>
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
            <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▼▼</button>
            <button class="fms-btn-grey" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▲▲</button>
        </div>

        <!-- Bottom Actions Row -->
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
                        <span>AAR201</span><span class="arrow-down">▼</span>
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
                <span class="text-white-fms">${isAltnActive ? 'ETD' : 'ETA'}</span>
                <span class="text-green-fms" style="font-weight: bold; margin-right: 15px;">${isAltnActive ? '1710Z' : '0612Z'}</span>
                <span class="text-white-fms">LOCAL</span>
                <span style="color: var(--text-green); font-weight: bold;">${isAltnActive ? '10:10 L' : '15:12 L'}</span>
            </div>
        </div>

        <!-- Table (13 rows) -->
        <table class="rte-summary-table mel-cdl-table" style="margin-bottom: 4px;">
            <tbody id="enrte-wx-table-body">
                ${getEnrteWxTableHTML()}
            </tbody>
        </table>

        <!-- Table Vertical Scroll Navigation -->
        <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 4px;">
            <button class="fms-btn-grey" id="btn-enrte-wx-scroll-down" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▼▼</button>
            <button class="fms-btn-grey" id="btn-enrte-wx-scroll-up" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▲▲</button>
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

    mainContent.innerHTML = `
        <!-- Folder Tabs -->
        <div class="fms-tabs" style="margin-bottom: 6px;">
            <div class="fms-tab active">DATABASE RTEs</div>
            <div class="fms-tab">PILOT STORED RTEs</div>
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
                <span class="text-green-fms" style="font-weight: bold; margin-right: 15px;">KLAX</span>
                <span class="text-white-fms">TO</span>
                <span class="text-green-fms" style="font-weight: bold;">RKSI</span>
            </div>
        </div>

        <!-- Route Summary Table (10 rows) -->
        <table class="rte-summary-table" style="margin-bottom: 4px;">
            <tbody>
                ${getRteSummaryTableHTML()}
            </tbody>
        </table>

        <!-- Table Vertical Scroll Navigation -->
        <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 4px;">
            <button class="fms-btn-grey" id="btn-route-scroll-down" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▼▼</button>
            <button class="fms-btn-grey" id="btn-route-scroll-up" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▲▲</button>
        </div>

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
                    <div class="fms-val-box extracted-value" style="width: 100px;">
                        <input type="text" value="${flightData.paxNbr}" data-field="paxNbr">
                    </div>
                </div>
            </div>
        </div>

        <!-- TRIP and MODE -->
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
                    <span class="fms-label label-right" style="width: 80px; text-align: right;">MODE</span>
                    <div class="fms-val-box white-text" style="width: 90px; justify-content: space-between;">
                        <span>${flightData.mode}</span><span class="arrow-down">▼</span>
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
                    <div class="fms-val-box extracted-value" style="width: 100px;">
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
                <button class="msg-btn btn-return" id="btn-return">RETURN</button>
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
                STEP ALTs FROM CRZ <span style="color: var(--text-cyan);">FL</span> <span style="color: var(--text-green);">300</span>
            </div>

            <!-- Table Grid -->
            <div class="step-alt-grid" style="display: grid; grid-template-columns: 1.15fr 0.95fr 0.95fr 0.95fr; gap: 4px; align-items: center;">
                <!-- Content generated dynamically by getStepAltsTableHTML() -->
            </div>
        </div>

        <!-- Table Vertical Scroll Navigation -->
        <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 4px;">
            <button class="fms-btn-grey" id="btn-step-scroll-down" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▼▼</button>
            <button class="fms-btn-grey" id="btn-step-scroll-up" style="width: 38px; height: 28px; font-size: 0.65rem; padding: 2px;">▲▲</button>
        </div>

        <!-- Max SR/Turb Point Box -->
        <div style="border: 1.5px solid #2f3542; border-radius: 4px; padding: 10px; position: relative; margin-top: 6px; margin-bottom: 6px; background-color: #12141a;">
            <span style="position: absolute; top: -8px; left: 10px; background-color: var(--fms-screen-bg); padding: 0 6px; font-size: 0.65rem; color: var(--text-gray); font-weight: bold; letter-spacing: 0.5px;">MAX SR/TURB POINT</span>
            <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.72rem; font-weight: bold;">
                <!-- Line 1: LTM Caution Zone -->
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
                <!-- Line 2: MOD Caution Zone -->
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
            </div>
        </div>

        <!-- Bottom Actions Row -->
        <div class="fms-row" style="margin-top: auto; padding-bottom: 2px; justify-content: flex-start; align-items: flex-end;">
            <button class="msg-btn btn-return" id="btn-return" style="height: 28px; width: 55px; font-size: 0.68rem; padding: 2px;">RETURN</button>
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
        if (['zfw', 'fob', 'taxi', 'trip', 'final', 'altnTime'].includes(field)) {
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
        activeEnrteWxTab = 'ALTN';
        renderInitPage();
    }

    // MEL/CDL trigger from INIT page
    if (e.target.closest('.btn-mel-cdl-trigger')) {
        renderMelCdlPage();
    }

    // DEP/ARR WX trigger from INIT page
    if (e.target.closest('.btn-dep-arr-wx-trigger')) {
        renderDepArrWxPage();
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
        if (depArrWxScrollIndex < maxScroll) {
            depArrWxScrollIndex++;
            const tbody = document.querySelector('.mel-cdl-table tbody');
            if (tbody) tbody.innerHTML = getDepArrWxTableHTML();
        }
    }
    
    // Scroll up click for DEP WX Table
    if (e.target.closest('#btn-dep-wx-scroll-up')) {
        if (depArrWxScrollIndex > 0) {
            depArrWxScrollIndex--;
            const tbody = document.querySelector('.mel-cdl-table tbody');
            if (tbody) tbody.innerHTML = getDepArrWxTableHTML();
        }
    }

    // Scroll down click for ENRTE WX Table
    if (e.target.closest('#btn-enrte-wx-scroll-down')) {
        const currentData = getProcessedEnrteWxData();
        const maxScroll = Math.max(0, currentData.length - 13);
        if (enrteWxScrollIndex < maxScroll) {
            enrteWxScrollIndex++;
            const tbody = document.querySelector('.mel-cdl-table tbody');
            if (tbody) tbody.innerHTML = getEnrteWxTableHTML();
        }
    }
    
    // Scroll up click for ENRTE WX Table
    if (e.target.closest('#btn-enrte-wx-scroll-up')) {
        if (enrteWxScrollIndex > 0) {
            enrteWxScrollIndex--;
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

    // Scroll down click for Route Summary Table
    if (e.target.closest('#btn-route-scroll-down')) {
        const maxScroll = Math.max(0, Math.ceil(routeData.length / 2) - 13);
        if (routeScrollIndex < maxScroll) {
            routeScrollIndex++;
            updateRteTableOnly();
        }
    }
    
    // Scroll up click for Route Summary Table
    if (e.target.closest('#btn-route-scroll-up')) {
        if (routeScrollIndex > 0) {
            routeScrollIndex--;
            updateRteTableOnly();
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

});

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
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
            setProgress(Math.round(40 + (i / numPages) * 45));
        }

        console.log('Parsed PDF Text:', fullText);
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

        // 6. AVG WIND/TEMP — "M031/M49" (M = minus/headwind, P = plus/tailwind)
        const windTempMatch = fullText.match(/\b([MP]\d{3})\s*\/\s*([MP]\d{1,2})\b/);
        if (windTempMatch) {
            flightData.tripWind = windTempMatch[1].toUpperCase();
            const t = windTempMatch[2].toUpperCase();
            flightData.crzTemp = (t.startsWith('M') ? '-' : '+') + t.substring(1) + ' °C';
            matchedCount++;
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
                const first = parseInt(paxMatch[1], 10);
                const business = parseInt(paxMatch[2], 10);
                const economy = parseInt(paxMatch[3], 10);
                flightData.paxNbr = String(first + business + economy);
            } else {
                flightData.paxNbr = paxMatch[1];
            }
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

        // 15. ETD/ETA — "ETD KLAX 1710Z ETA RKSI 0612Z"
        const etaMatch = fullText.match(/ETA\s+[A-Z]{4}\s+(\d{2})(\d{2})Z/i);
        if (etaMatch) { destUtc = etaMatch[1] + ':' + etaMatch[2]; matchedCount++; }

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
    const bezelWidth = 930; // 580px (bezel) + 30px (gap) + 320px (debug panel)
    const bezelHeight = 740;
    const padding = 20; // safe area padding
    
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    
    // Calculate scale to fit both width and height perfectly within the viewport
    let scale = Math.min((winW - padding) / bezelWidth, (winH - padding) / bezelHeight);
    
    // Set a minimum scale limit for readability on very small screens (e.g. 0.5)
    const minScale = 0.5;
    if (scale < minScale) {
        scale = minScale;
    }
    
    // Set scale CSS variable on body
    document.body.style.setProperty('--scale', scale);
}

// Attach listeners for scaling and panels
window.addEventListener('resize', adjustBezelScale);
window.addEventListener('DOMContentLoaded', () => {
    adjustBezelScale();
    updateDebugPanel();
});
adjustBezelScale();
updateDebugPanel();
// Run a small delay to handle iPad Safari layout quirks on load
setTimeout(adjustBezelScale, 100);
setTimeout(adjustBezelScale, 500);
