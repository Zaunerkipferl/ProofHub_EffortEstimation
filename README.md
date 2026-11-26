# Effort Estimation

A web tool for your internal network. It creates COPA-DATA effort estimation
sheets (`EffortEstimation_<Customer>_<Project>.xlsx`) with the same layout as
the reference template: sheet `REQ`, the requirement table, the totals with
formulas, the effort factor and the delivery time.

The UI uses [Material Web](https://github.com/material-components/material-web)
(Material 3) with a COPA-DATA color theme. Fonts and icons are bundled, so the
app needs no internet access at runtime.

## Features

| Step | Status |
| --- | --- |
| 1. Create an estimation from scratch and export it as `.xlsx` | ✅ done |
| Save estimations on the server, reopen and edit them, search the list | ✅ done |
| Import an existing estimation `.xlsx` into the editor | ✅ done |
| 2. Upload the sheet to a ProofHub item | ⏳ placeholder (`server/proofhub.js`) |
| 3. Update a sheet that is already in ProofHub | ⏳ placeholder (`server/proofhub.js`) |

## Run

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
server/index.js     Express API + serves the built frontend
server/xlsx.js      Builds and parses the workbook (template layout, styles, formulas)
server/store.js     JSON-file storage for saved estimations
server/proofhub.js  ProofHub integration (steps 2 + 3, placeholder)
web/                Frontend (Material Web components, Vite)
web/theme.css       All theme colors (M3 tokens) — adjust the brand colors here
```

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/config` | Requirement types and whether ProofHub is configured |
| `POST` | `/api/export` | Estimation JSON → `.xlsx` download |
| `POST` | `/api/import` | Multipart `file` (`.xlsx`) → estimation JSON |
| `GET/POST` | `/api/estimations` | List / create |
| `GET/PUT/DELETE` | `/api/estimations/:id` | Read / update / delete |
| `GET` | `/api/estimations/:id/xlsx` | Download a saved estimation |
| `POST/PUT` | `/api/estimations/:id/proofhub` | Upload / update in ProofHub (returns 501 for now) |
