# Smart Crop Monitor & Agro-Analytics Platform

[![CI](https://github.com/niki8885/SmartCropMonitor/actions/workflows/pre-merge-tests.yml/badge.svg)](https://github.com/niki8885/SmartCropMonitor/actions/workflows/pre-merge-tests.yml)
[![Build & Deploy](https://github.com/niki8885/SmartCropMonitor/actions/workflows/deploy_status.yml/badge.svg)](https://github.com/niki8885/SmartCropMonitor/actions/workflows/deploy_status.yml)
[![codecov](https://codecov.io/github/niki8885/SmartCropMonitor/graph/badge.svg?token=GMT9L3FYGB)](https://codecov.io/github/niki8885/SmartCropMonitor)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=niki8885_SmartCropMonitor&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=niki8885_SmartCropMonitor)
[![Maintainability](https://qlty.sh/gh/niki8885/projects/SmartCropMonitor/maintainability.svg)](https://qlty.sh/gh/niki8885/projects/SmartCropMonitor)

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.MD)
![Python](https://img.shields.io/badge/Python-3.12-3670A0?style=flat-square&logo=python&logoColor=ffdd54)
![FastAPI](https://img.shields.io/badge/FastAPI-0.136-009688?style=flat-square&logo=fastapi&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-323330?style=flat-square&logo=javascript&logoColor=F7DF1E)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)
![Haskell](https://img.shields.io/badge/Haskell-9.10-5e5086?style=flat-square&logo=haskell&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18%20+%20PostGIS-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![PyTorch](https://img.shields.io/badge/PyTorch-EE4C2C?style=flat-square&logo=pytorch&logoColor=white)
![WRF](https://img.shields.io/badge/WRF-4.5.2-013243?style=flat-square)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)

A high-performance agro-analytical backend designed for real-time farm management, precision agriculture, and automated risk assessment. The platform integrates satellite imagery processing, micro-climate physical modeling (WRF), deep learning segmentation, and biological risk engines to deliver actionable insights directly to farmers.

---

## Core Architectural Modules

### 1. Meteorological Core & Multi-Source Weather Ingestion

Handles precise grid-relative weather indexing and calculation of essential agro-meteorological metrics.

* **WRF (Weather Research and Forecasting) Ingestion (`wrf_service.py`):** Parses high-resolution NetCDF4 outputs from local WRF physical model simulations. Includes automated spatial mapping via grid distance triangulation (`_find_nearest_grid_point`) to match exact farm locations (`UserLocation`).
* **Open-Meteo & Open-Elevation Integration (`weather_service.py`):** Acts as a highly resilient fallback sync pipeline using automated HTTP exponential backoff retries (`_http_session`).
* **Agro-Meteorological Metrics:** Processes complex data structures through high-performance compute engines to extract advanced indices like Evapotranspiration ($ET_0$), Vapor Pressure Deficit ($VPD$), Growing Degree Days ($GDD$), and Soil Moisture/Temperature profiles.

### 2. Satellite Ingestion & Remote Sensing Pipeline

An automated pipeline for gathering and processing vegetation health matrices.

* **STAC-Driven Ingestion (`orchestrator.py`):** Queries and pulls `sentinel-2-l2a` bands directly over target bounds.
* **Multi-Spectral Indices Engine (`ndvi_processor.py`):** Computes precise field-level matrices mapping raw spatial variables to high-level vegetation health indicators:
* **NDVI** (Normalized Difference Vegetation Index) — General biomass and greenness.
* **GNDVI** (Green NDVI) — Chlorophyll sensitivity monitoring.
* **NDRE** (Normalized Difference Red Edge) — Late-stage crop canopy vigor.
* **NDWI & NMDI** — Plant water stress and soil moisture dynamics.


* **Zonal Extraction (`calculate_per_field_metrics`):** Clips high-resolution multi-spectral rasters directly against spatial database geometries (`GeoAlchemy2`/`WKB`), extracting statistical profiles (Mean, Min, Max, Std) for each independent farming sector.

### 3. Deep Learning Field Segmentation

* **UTAE (U-TimeSpatial Spatial-Temporal Attention) Model (`segmentation.py`):** Leverages neural networks optimized for multi-temporal satellite data. It dynamically runs batch inference on cloud-masked NetCDF sequences over full tile areas to isolate individual agricultural land entities without manual vector tracing.
* **Geospatial Extraction:** Automatically vectorizes neural network binary masks back into real-world geographic coordinates (`EPSG:4326` MultiPolygons) and runs topological sanity checks (`validate_field_shape`) to calculate field areas in hectares ($ha$) prior to database commitment.

### 4. Disease Risk & Epiphytoty Forecasting Engine

Continuous sliding-window disease prediction module (`disease_service.py`) running automated analysis over 48-hour, 7-day, and 10-day weather time-series matrices synchronized with the plant's actual development stage (**BBCH scale**).

* **Botrytis cinerea:** Evaluates risk scores based on uninterrupted leaf wetness and strict temperature threshold durations over a 48-hour window.
* **TOMCAST:** Calculates Daily Severity Values ($DSV$) to manage early blight, Septoria, and fruit anthracnose treatments.
* **Blitecast:** Monitors late blight occurrence ($P$-Value accumulation thresholds).
* **Plasmopara viticola (Downy Mildew):** Tracks spore incubation using multi-day rainfall volume data paired with micro-climatic humidity tracking.

### 5. Smart Spraying Window Optimization

* **Dynamic Validation (`spraying_service.py`):** Combines an 8-day hourly forecast matrix ($T$, $H$, wind speed, precipitation, $ET_0$, $VPD$) to determine safe chemical application periods.
* **Risk Mitigation:** Flags critical constraints such as chemical drift risks (high wind speed), high evaporation gaps ($VPD$), or immediate wash-off risks (precipitation).

### 6. Automated Statistical Anomaly Processor

* **Sudden Change Detection (`spot_anomaly_processor.py`):** Evaluates multi-temporal satellite observations on a pixel-by-pixel basis.
* **Spatial Cluster Extraction:** If a sub-sector of a field demonstrates a sudden, statistically significant vegetative drop (exceeding adaptive area ratio thresholds), it isolates the anomaly, rates it by confidence level (`WARNING`, `HIGH`, `CRITICAL`), and issues targeted crop protection alerts.

### 7. Custom Alert Engine & Real-Time Sensor Processing

* **Live Streams (`sensor_servise.py`):** Direct hardware integration via secure telemetry payloads (`WeatherSensors`) using cryptographic key validation.
* **Dynamic Rule Definition:** An upcoming user-defined alert framework allowing farmers to write specific logic thresholds (e.g., *“Alert if soil temperature at 0cm drops below 2°C while air humidity is > 85%”*). Processes micro-streams instantly through automated webhook alerting pathways.

### 8. Pasture Rotation & Smart Grazing Optimization

* **Forage Allocation Matrices:** Utilizing multi-spectral tracking data to monitor vegetative regeneration velocity inside rotational grazing zones.
* **Regenerative Agriculture Analytics:** Automated recommendation engines computing optimal stocking rates, precise days of occupancy ($DO$), and mandatory rest periods ($RP$) per pasture sector to prevent soil compaction and overgrazing.

### 9. AI Biomass Estimation Engine

* **Dry Matter Yield ($DMY$) Projections:** Merging historical $GDD$ accumulations, spatial soil moisture layers, and radar/optical satellite signatures into predictive crop modeling systems.
* **Harvest Timeline Optimization:** Live tonnage estimations allowing farmers to plan logistical supply chains and predict actual yield capacity weeks before physical machinery enters the field.

---

## Tech Stack Specification

The system is built on a decoupled, heterogeneous microservices architecture designed to isolate high-throughput data parsing, compute-heavy deep learning models, and complex functional data pipelines.

* **Backend Core:** Python 3.12 / FastAPI (High-performance asynchronous API gateway and task execution orchestrator).
* **Geospatial Analysis Compute:** Haskell (GHC 9.x / Stack). Handles pure, deterministic vector-to-raster validation, custom alerting thresholds, and micro-climatic multi-day risk aggregates (`haskell-service`).
* **Database Layers:** PostgreSQL + **PostGIS** extension (Handles topological field boundaries, relational farm hierarchies, and spatial indexing).
* **Numerical Weather Prediction (NWP):** WRF (Weather Research and Forecasting) v4.x + WPS (WRF Preprocessing System). Run inside dedicated ephemeral containers for boundary-layer downscaling.
* **Deep Learning & Matrix Core:** PyTorch (Inference optimization for temporal semantic segmentation), `Xarray` / `Rioxarray` (Distributed NetCDF4/GeoTIFF ingestion and geospatial array operations).

---

## Project Directory Structure

```text
SmartCropMonitor/
├── .github/                   # CI/CD Workflows and automated deployment actions
├── backend/                   # FastAPI Core Enterprise Application
│   ├── app/
│   │   ├── api/               # REST API Routes and controllers
│   │   ├── core/              # Global Configurations, Database initialization, and Schemas
│   │   ├── events/            # Telemetry processing hooks and async notification pipes
│   │   ├── models/            # ML Architecture definitions (e.g., UTAE, UNet) and binary weights
│   │   ├── monitoring/        # Critical alerting infrastructure and remote sync endpoints
│   │   ├── services/          # Pure analytical services (WRF, NDVI, Disease Risk, Spraying Window)
│   │   ├── tasks/             # Scheduled background synchronization loops
│   │   └── utils/             # Spatial geometry and mathematical calculation helpers
│   ├── data/                  # Embedded local application data configuration mappings
│   └── Dockerfile             # Production multi-stage build script for backend core
├── docs/                      # Architectural Specification Docs
│   ├── assets/diagrams/       # Compiled schemas (ERD, Neural Net Topologies: UTAE, UNet)
│   └── iot/                   # Hardware blueprints, schematic specs, and ESP32 reference firmware
├── frontend/                  # Single Page Application (Vite + React / TypeScript Dashboard)
├── haskell-service/           # High-Performance Analytics Compute (Cabals & Stack-built binary)
├── notebooks/                 # Research environments for Deep Learning model tracking and calibration
├── wrf-preprocessor/          # Geogrid, Ungrib, and Metgrid execution layer container (WPS)
├── wrf-runner/                # Real-time boundary downscaling container (WRF Core)
├── .env                       # Decentralized deployment environment keys
├── docker-compose.yml         # Container topology orchestration schema
└── requirements.txt           # Monolithic python environment snapshot declaration

```

---

## Network Topology & Ports Architecture

The following matrix isolates internal cross-container routing boundaries and public ingress definitions:

| Container Service | External Port | Internal Port | Protocol | Network Routing Target | Access Domain |
| --- | --- | --- | --- | --- | --- |
| `backend` | `8000` | `8000` | HTTP/TCP | Main API Gateway / Core Orchestrator | Public / Reverse Proxy |
| `haskell-service` | `8081` | `8081` | HTTP/TCP | Statistical compute endpoints (`/field-stats`) | Private / Internal Only |
| `frontend` | `3000` | `80` | HTTP/TCP | Production Nginx hosting compiled web client assets | Public Ingress |
| `wrf-preprocessor` | *None* | *None* | Ephemeral | One-shot processing container run natively on the host docker daemon | Shared Storage IPC |
| `wrf-runner` | *None* | *None* | Ephemeral | One-shot processing container bounded to strict computational hardware limits | Shared Storage IPC |

---

## Docker Container Topology & Shared Volumes

The platform utilizes standard Docker isolation configurations to decouple persistent APIs from compute-heavy pipelines.

### Persistent Services

* **`backend`:** Mounts host Docker socket (`/var/run/docker.sock`). This gives the API the capability to launch sibling one-shot container instances (`wrf-preprocessor` / `wrf-runner`) dynamically via subprocess operations when target farm configurations are added or modified.
* **`haskell-service`:** Runs fully isolated and detached without storage hooks, processing pure functional computations across standard memory allocations.
* **`frontend`:** Injects production configuration endpoints (`VITE_API_URL`) and spatial keys (`VITE_MAPBOX_TOKEN`) at build-time directly into a static web tier.

### Ephemeral / Profile-Driven Batch Processing

The WRF modeling containers are managed via standard **Docker Compose Profiles (`profile: ["wrf"]`)**. They stay completely down until explicitly awakened by the core task manager, bypassing persistent memory consumption during quiet cycles.

### Storage Volumetric Mapping

A centralized high-performance local storage grid handles zero-copy matrix tracking:

```yaml
volumes:
  wrf_shared_exchange: # Inter-container workspace handling binary netCDF arrays

```

* **`wrf_shared_exchange` Layer:** Binds `backend`, `wrf-preprocessor`, and `wrf-runner` together.
1. The `backend` writes custom geo-referenced target metrics (`namelist.wps`) to the shared mount.
2. The `wrf-preprocessor` reads the instructions, downloads external GFS boundary inputs, extracts geographical layers, and outputs binary grids into the shared space.
3. The `wrf-runner` reads the processed grids, binds them to real hardware limits (maximum `4G` RAM, allocating a dedicated `3G` reservation to optimize memory footprints), processes the fluid dynamics variables, and returns final weather grids into the storage volume.
4. The `backend` triggers its local ingestion script to map the output metrics directly down into PostgreSQL.


* **Terrain Data Layer (`/mnt/volume-nbg1-2/topo`):** High-capacity static topological data volume attached directly as a read-only parameter to the preprocessor stage. This lets the modeling engine process precise digital elevation parameters locally without repetitive data lookups.

---

## Local Development Setup

### 1. Prerequisites
Ensure you have the following installed:
* **Python 3.12**
* **Node.js & npm**
* **Haskell Stack** & **Cabal**

### 2. Backend (FastAPI)
The backend handles the core logic and API endpoints.

```bash
# Navigate to backend directory
cd backend

# Install dependencies
pip install -r requirements.txt

# Run the server
# Note: In PyCharm, you can mark 'backend' as 'Sources Root'
uvicorn app.main:app --reload
```
The API will be available at `http://localhost:8000`.

### 3. Frontend (React)
The web interface for monitoring.

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```
The dashboard will be available at `http://localhost:3000`.

### 4. Haskell Service
This service handles.

```bash
# Navigate to haskell-service directory
cd haskell-service

# Initialize and build the project
stack init --force
stack build

# Run the service
stack run
```
Here is a clean, professional, and clear section for your **README.md** written in English. It outlines the exact steps needed to clone the required submodules/repositories into their designated folders and explains how to generate the topography data.

---

## Weather Simulation Setup (WRF & WPS)

This section describes how to clone the necessary core meteorological models and prepare the high-resolution 7.5 arc-second GMTED2010 topography dataset.

### 1. External Repositories Installation

The project uses external sources for `WPS` (Weather Preprocessing System) and `WRF` (Weather Research and Forecasting). They must be cloned into their respective service directories.

From the root of the monorepository, run the following commands:

```bash
# Clone WPS into the wrf-preprocessor service
git clone https://github.com/wrf-model/WPS.git wrf-preprocessor/WPS

# Clone WRF into the wrf-runner service
git clone https://github.com/wrf-model/WRF.git wrf-runner/WRF

```

---

### 2. Topography Data Preparation (GMTED2010 7.5 arc-seconds)

`geogrid.exe` requires terrestrial static data converted into the specialized WPS binary format. Follow these steps to process the raw data using QGIS and a Python utility script.

#### Step A: Download Raw Data from USGS

1. Download the **Mean Statistic, 7.5 arc-seconds** dataset from the official USGS servers:
* [USGS GMTED2010 mn75_grd.zip](https://www.google.com/search?q=https://edcintl.cr.usgs.gov/downloads/sciweb1/shared/topo/downloads/GMTED/Grid_ZipFiles/be15_grd.zip) (Ensure you select the `mn75` version for the mean elevation data).


2. Extract the downloaded archive. You will see a folder containing `.adf` files (Esri Grid format), where the main dataset file is usually named `w001001.adf`.

#### Step B: Export to GeoTIFF via QGIS

1. Launch **QGIS** and drag-and-drop the `w001001.adf` file onto the main map canvas.
2. In the top menu, go to **Raster** $\rightarrow$ **Conversion** $\rightarrow$ **Translate (Convert Format)...**
3. Configure the following parameters in the translation window:
* **Input layer:** Select your loaded elevation grid layer.
* **Advanced Parameters** $\rightarrow$ **Output data type:** Select **Int16** *(Strictly required for WRF)*.
* **Converted:** Click the three dots `...`, choose **Save to File...**, and save the file as `D:\topo.tif`.


4. Click **Run** to execute the export.

#### Step C: Convert GeoTIFF to WPS Binary Format

To format the GeoTIFF image into big-endian matrix tiles along with the necessary geographical passport (`index` file), use the automated Python conversion script.

1. Ensure you have the required dependencies installed in your workspace:
```bash
pip install rasterio numpy

```


2. Create and run a temporary script (e.g., `make_topo.py`) using the code block below:

```python
import os
import numpy as np
import rasterio

# Minimalist conversion script for GMTED2010 7.5s grid
tif_path = r"D:\topo.tif"
output_dir = "backend/data/storage/topo/gmted2010_7.5s"
os.makedirs(output_dir, exist_ok=True)

with rasterio.open(tif_path) as src:
    topo_data = src.read(1)
    bounds = src.bounds
    res_x, res_y = src.res  
    height, width = topo_data.shape

# Replace NoData artifacts with sea level (0 meters)
topo_data[topo_data < -1000] = 0
topo_data = topo_data.astype(np.int16)

# Generate WPS compliant filename matrix
tile_name = f"00001-{width:05d}.00001-{height:05d}"
output_file = os.path.join(output_dir, tile_name)

print(f"Writing WPS binary tile matrix: {width}x{height}...")
with open(output_file, "wb") as f:
    # Force big-endian byte swapping for Fortran unformatted read compatibility
    topo_data.byteswap().tofile(f)

# Build the required geogrid metadata index descriptor
index_content = f"""type=continuous
signed=yes
projection=regular_ll
dx={res_x:.9f}
dy={res_y:.9f}
known_x=1.0
known_y={height:.1f}
known_lat={bounds.top:.6f}
known_lon={bounds.left:.6f}
wordsize=2
tile_x={width}
tile_y={height}
tile_z=1
units="meters"
description="GMTED2010 7.5 arc-seconds elevation"
"""

with open(os.path.join(output_dir, "index"), "w") as f:
    f.write(index_content)

print("Target terrain dataset generation completed successfully.")

```

#### Step D: Final Integrity Check

Navigate to the newly generated folder. Your file tree structure must match this layout perfectly:

```text
backend/data/storage/topo/
└── gmted2010_7.5s/
    ├── 00001-XXXXX.00001-YYYYY  # The processed binary grid tile (No extension)
    └── index                    # The terrain passport configuration (No extension)

```

The resulting topography path is mounted natively into the Docker ecosystem using `docker-compose.yml` volumes for deployment executions.
## Documentation

* **`docs/`** — Core project documentation and technical guidelines:
    * `CONTRIBUTING.md` — Instructions for contributing to the project.
    * `SECURITY.md` — Security policies and vulnerability disclosure process.
    * `MODEL_CARD.md` — ML model characteristics, limitations, and performance indicators.
    * `DATA_SPEC.md` — Sentinel-2 data schema, band selection rules, spatial resolution definitions, and auxiliary layer structure.
    * `ARCHITECTURE.md` — System architecture, processing pipeline, and service interaction overview.
    * `API_SPEC.md` — API endpoints, request/response schemas, and authentication details.
    * `Computational_Methods.md` — Calculations, methodology.


### Documentation Assets

* **`docs/assets/`** — Static assets used across documentation:
    * `diagrams/` — System architecture, workflow, and database diagrams.
    * `ui/` — UI screenshots and interface mockups.
    * `visualizations/` — Generated plots, graphs, NDVI maps, and analytical figures.

---

## GitHub Configuration

* **`.github/`** — GitHub workflows and collaboration templates:
    * `ISSUE_TEMPLATE/` — Templates for bug reports, feature requests, and ML experiment tracking.
    * `PULL_REQUEST_TEMPLATE.md` — Standardized checklist for pull requests.

---

## Research and Experimentation

* **`notebooks/`** — Research notebooks, exploratory analysis, prototyping, and experiments.

---

## Root Directory

* `LICENSE.md` — AGPLv3 open-source license.
* `COMMERCIAL-LICENSE.md` — Commercial licensing terms and usage conditions.
* `CODE_OF_CONDUCT.md` — Community participation and behavior standards.
* `README.md` — Project overview, setup instructions, and quick start guide.
* `requirements.txt` — Global Python dependencies.
* `.env.example` — Example environment configuration template.

---
## Dual Licensing

This project is distributed under a dual licensing model.

You may choose between an open-source license or a commercial license depending on your use case.

---

## 1. Open Source License (AGPLv3)

This software is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

You may use, modify, and distribute this software under the terms of the AGPL-3.0 license.

### Key obligations under AGPL-3.0:

- If you run this software as a network service (e.g., SaaS, API, web application),
  you must provide access to the corresponding source code, including modifications.
- Any distributed or network-deployed version must remain under AGPL-3.0.

See the LICENSE file for full license terms.

---

## 2. Commercial License

A separate commercial license is available for individuals or organizations
that do not wish to comply with the requirements of the AGPL-3.0 license.

The commercial license grants additional rights, including:

- Use in proprietary or closed-source software
- Use in commercial SaaS or hosted services without source code disclosure
- Embedding into paid products or services
- Redistribution without AGPL obligations

---

## Commercial Licensing

For commercial licensing inquiries, please contact:

📧 nikita.manaenkov@gmail.com

---

## 3. Important Note

The commercial license is an alternative to the AGPL license.
You must choose one of the two licensing options depending on your use case.
---


git commit -m "chore(data): ingest latest weather and satellite imagery"

## Documentation

* **`docs/`** — Core project documentation and technical guidelines:
    * `CONTRIBUTING.md` — Instructions for contributing to the project.
    * `SECURITY.md` — Security policies and vulnerability disclosure process.
    * `MODEL_CARD.md` — ML model characteristics, limitations, and performance indicators.
    * `DATA_SPEC.md` — Sentinel-2 data schema, band selection rules, spatial resolution definitions, and auxiliary layer structure.
    * `ARCHITECTURE.md` — System architecture, processing pipeline, and service interaction overview.
    * `API_SPEC.md` — API endpoints, request/response schemas, and authentication details.

### Documentation Assets

* **`docs/assets/`** — Static assets used across documentation:
    * `diagrams/` — System architecture, workflow, and database diagrams.
    * `ui/` — UI screenshots and interface mockups.
    * `visualizations/` — Generated plots, graphs, NDVI maps, and analytical figures.

---

## GitHub Configuration

* **`.github/`** — GitHub workflows and collaboration templates:
    * `ISSUE_TEMPLATE/` — Templates for bug reports, feature requests, and ML experiment tracking.
    * `PULL_REQUEST_TEMPLATE.md` — Standardized checklist for pull requests.

---

## Research and Experimentation

* **`notebooks/`** — Research notebooks, exploratory analysis, prototyping, and experiments.

---

## Root Directory

* `LICENSE.md` — AGPLv3 open-source license.
* `COMMERCIAL-LICENSE.md` — Commercial licensing terms and usage conditions.
* `CODE_OF_CONDUCT.md` — Community participation and behavior standards.
* `README.md` — Project overview, setup instructions, and quick start guide.
* `requirements.txt` — Global Python dependencies.
* `.env.example` — Example environment configuration template.

---
## Dual Licensing

This project is distributed under a dual licensing model.

You may choose between an open-source license or a commercial license depending on your use case.

---

## 1. Open Source License (AGPLv3)

This software is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

You may use, modify, and distribute this software under the terms of the AGPL-3.0 license.

### Key obligations under AGPL-3.0:

- If you run this software as a network service (e.g., SaaS, API, web application),
  you must provide access to the corresponding source code, including modifications.
- Any distributed or network-deployed version must remain under AGPL-3.0.

See the LICENSE file for full license terms.

---

## 2. Commercial License

A separate commercial license is available for individuals or organizations
that do not wish to comply with the requirements of the AGPL-3.0 license.

The commercial license grants additional rights, including:

- Use in proprietary or closed-source software
- Use in commercial SaaS or hosted services without source code disclosure
- Embedding into paid products or services
- Redistribution without AGPL obligations

---

## Commercial Licensing

For commercial licensing inquiries, please contact:

📧 nikita.manaenkov@gmail.com

---

## 3. Important Note

The commercial license is an alternative to the AGPL license.
You must choose one of the two licensing options depending on your use case.
---
