# Effort Estimation

A web tool for your internal network. It creates COPA-DATA effort estimation
sheets (`EffortEstimation_<Customer>_<Project>.xlsx`) with the same layout as
the reference template: sheet `REQ`, the requirement table, the totals with
formulas, the effort factor and the delivery time.

The UI uses [Material Web](https://github.com/material-components/material-web)
(Material 3) with the COPA-DATA website palette (navy #202d4f, orange #f04e23) and fonts (Ubuntu, Noto Sans). Fonts and icons are bundled, so the
app needs no internet access at runtime.

## Features

| Step | Status |
| --- | --- |
| 1. Create an estimation from scratch and export it as `.xlsx` | ✅ done |
| Save estimations on the server, reopen and edit them, search the list | ✅ done |
| Import an existing estimation `.xlsx` into the editor | ✅ done |
| Light/dark switch; remembers the mode, the last opened estimation and unsaved edits (per browser) | ✅ done |
| 2. Upload the sheet to a ProofHub item | ⏳ placeholder (`server/proofhub.js`) |
| 3. Update a sheet that is already in ProofHub | ⏳ placeholder (`server/proofhub.js`) |

## Windows: installer (recommended for a single PC)

Download `EffortEstimation-Setup-<version>.exe` from the latest successful
[**Windows build**](../../actions/workflows/windows.yml) run (artifact
"EffortEstimation-windows"), or build it yourself with `npm run build:windows`.

The installer needs no administrator rights and no Node.js. It installs to
`%LOCALAPPDATA%\Programs\EffortEstimation` and adds:

- **Start menu → Effort Estimation**: opens the app in the browser (starts it if needed)
- **Start menu → Stop Effort Estimation**
- **Start menu → Effort Estimation settings and data**: opens the folder with `config.json`, saved estimations and the log
- optional **autostart** when you log in to Windows (selected by default), and an optional desktop shortcut
- an entry in *Settings → Apps* to uninstall (saved estimations are kept)

The app runs in the background without a window, on **http://localhost:3080** by
default. Settings live in `%LOCALAPPDATA%\EffortEstimation\config.json`:

```json
{ "port": 3080, "host": "0.0.0.0", "dataDir": "", "proofhubCompany": "", "proofhubApiKey": "" }
```

After changing it, use *Stop Effort Estimation* and start it again. `dataDir` empty
means `%LOCALAPPDATA%\EffortEstimation\data`. The log is in `...\EffortEstimation\logs\server.log`.

Notes:
- The exe is not code-signed, so Windows SmartScreen may warn on first run
  ("More info" → "Run anyway").
- To let colleagues open it via `http://<your-pc>:3080`, Windows Firewall must
  allow incoming connections on that port (Windows asks the first time; this
  needs administrator approval).
- Autostart starts the app when you log in, not before login. For a shared
  server that must run without anyone logged in, use Docker or a Windows service.

## Run with Node.js

You need Node.js 20 or later.

```bash
npm install
npm run build
npm start            # http://<host>:3000
```

With Docker:

```bash
docker build -t effort-estimation .
docker run -d -p 3000:3000 -v effort-data:/data --name effort-estimation effort-estimation
```

### Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Where saved estimations are stored (one JSON file each) |
| `PROOFHUB_COMPANY` | – | ProofHub subdomain (`<company>.proofhub.com`), for step 2 |
| `PROOFHUB_API_KEY` | – | ProofHub API key, for step 2. It stays on the server. |

There is no login. Run the app only on a trusted internal network, or put it
behind your reverse proxy with SSO.

## Development

```bash
npm run dev     # API on :3000 + Vite dev server on :5173 with hot reload
npm test        # xlsx build/parse tests against the reference files in test/fixtures
```

## Project layout

```
server/app.js       Express API (all routes)
server/index.js     Entry for Node.js / Docker
server/windows.js   Entry for the Windows executable (single instance, --open/--stop, config.json)
scripts/            build-windows.mjs: single executable + NSIS installer
installer/          NSIS installer script and app icon
server/xlsx.js      Builds and parses the workbook (template layout, styles, formulas)
server/store.js     JSON-file storage for saved estimations
server/proofhub.js  ProofHub integration (steps 2 + 3, placeholder)
web/                Frontend (Material Web components, Vite)
web/theme.css       All theme colors (M3 tokens) — adjust the brand colors here
```

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | App id and version |
| `GET` | `/api/config` | Requirement types and whether ProofHub is configured |
| `POST` | `/api/export` | Estimation JSON → `.xlsx` download |
| `POST` | `/api/import` | Multipart `file` (`.xlsx`) → estimation JSON |
| `GET/POST` | `/api/estimations` | List / create |
| `GET/PUT/DELETE` | `/api/estimations/:id` | Read / update / delete |
| `GET` | `/api/estimations/:id/xlsx` | Download a saved estimation |
| `POST/PUT` | `/api/estimations/:id/proofhub` | Upload / update in ProofHub (returns 501 for now) |
