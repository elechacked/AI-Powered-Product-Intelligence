# AI-Powered Product Intelligence

An end-to-end data enrichment system with explainability and self-validation. This system ingests sparse product data and produces 252-column Unilog delivery format records using a 6-agent AI pipeline.

## Features

- **Multi-Agent Pipeline**: 6 distinct agents (Scraper, Classifier, Extractor, Normalizer, Writer, Validator).
- **Explainable AI**: Every enriched field contains a source URL, snippet, and reasoning.
- **Adaptive Crawler Fallback**: Uses Cheerio for fast static extraction and seamlessly falls back to Playwright to extract data from SPAs and hidden tabs/accordions only when necessary.
- **Export to Unilog Format**: Deterministic mapping to 252-column output.
- **Dynamic Extractor**: Dynamically identifies and extracts attributes using LLMs.
- **Built-in Validation**: Deterministic rules ensure character limits and UOM formatting.

## Setup

### Prerequisites

- Node.js 18+

### 1. Environment Configuration

Copy the example environment file in the root folder to `.env` inside `backendv2` and `frontend`.
```bash
cp .env.example backendv2/.env
cp .env.example frontend/.env
```
Add your `GEMINI_API_KEY` and `GROQ_API_KEY` (and `SERPER_API_KEY` if needed) to `backendv2/.env`.

### 2. Backend Setup

The backend relies on a custom standalone crawler engine that must be built first.

```bash
# Build the engine
cd backendv2/engine
npm install
npm run build

# Setup the backend
cd ..
npm install
# Note: Playwright requires browsers to be installed
npx playwright install
```

### 3. Frontend Setup

```bash
cd frontend
npm install
```

## Running the Application

Start the application by running the backend and frontend separately.

### Start Backend

```bash
cd backendv2
node --env-file=.env server.mjs
```
The backend API will run on `http://localhost:9100`.

### Start Frontend

```bash
cd frontend
npm run dev
```

The frontend will be available at `http://localhost:4174`.

## Demo Instructions

1. Access the web interface.
2. Upload a sample `.csv` or `.xlsx` file containing sparse product data.
3. Observe the batch progress via the dashboard.
4. Click on a product to view the explainable enrichment data (source URL, reasoning, confidence).
5. Address any highlighted validation issues or conflicts.
6. Export the enriched batch to the 252-column Unilog format via the Export page.
