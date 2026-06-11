# A380 FMS Multi-Function Display (MFD) - Cockpit Prep Card

A modern, highly accurate, and responsive web-based simulation of the Airbus A380 Flight Management System (FMS) / Multi-Function Display (MFD) for cockpit preparation, designed by and for A380 pilots.

This tool parses operational flight plans (OFP) and weather briefings from PDFs to automatically fill, highlight, and cross-check critical flight data.

## 🚀 Key Features

* **Smart PDF Importer**: Directly imports Operational Flight Plans (OFP) in PDF format to parse and fill flight initialization values (FLT NBR, ACFT REG, APMS, FROM/TO/ALTN, CRZ FL/TEMP, TROPO, CI, TRIP WIND).
* **Step Climbs & Turbulence (SR) Tracker**: Automatically parses shear rate (SR) values and groups them chronologically into Green (LGT to MOD) and Red (MOD to SVR) caution zones in the `MAX SR/TURB POINT` view.
* **Smart Meteorological (MET) Briefing**:
  * Displays TAF info for Departure, Arrival, Alternate, and Enroute weather.
  * **Interactive Highlights**: Automatically highlights (in **Green**) the specific TAF time-window block closest to the Departure (ETD) or Arrival (ETA) times for each airport.
  * Separates multiple airports within the same list using a blank line for optimal readability.
* **iPad Ready**: Optimized layout with horizontal scaling prevention, high-sensitivity touch controls (eliminating zoom conflicts), and standalone Progressive Web App (PWA) support with the title **"A380 MFD"**.

## 🛠️ Usage

1. Open the page in your browser or save it to your iPad home screen ("Add to Home Screen").
2. Click **IMPORT** at the top right of the `ACTIVE/INIT` screen to upload your PDF flight plan.
3. Review the parsed fields, which will automatically highlight green when matching target OFP criteria.
4. Go to `DEP/ARR WX` or `STEP ALT` tabs to cross-check weather forecasts and turbulence zones.

## 💻 Tech Stack

* **Core**: Pure HTML5, Semantic CSS3, and Vanilla JavaScript.
* **Libraries**: PDF.js (Client-side PDF text extraction).
* **Fonts**: 'Share Tech Mono' & 'Courier Prime' for an authentic cathode-ray tube (CRT) display look.
