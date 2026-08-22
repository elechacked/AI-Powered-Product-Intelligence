# AI-Powered Product Intelligence

An end-to-end data enrichment system with explainability and self-validation. This system ingests sparse product data and produces 252-column Unilog delivery format records using a 6-agent AI pipeline.

## Features

- **Multi-Agent Pipeline**: 6 distinct agents (Scraper, Classifier, Extractor, Normalizer, Writer, Validator).
- **Explainable AI**: Every enriched field contains a source URL, snippet, and reasoning.
- **Background Processing**: FastAPI BackgroundTasks handles asynchronous pipeline execution.
- **Export to Unilog Format**: Deterministic mapping to 252-column output.
- **Dynamic Extractor**: Dynamically identifies and extracts attributes.
- **Built-in Validation**: Deterministic rules ensure character limits and UOM formatting.

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+

### 1. Environment Configuration

Copy the example environment file in the backend folder:
```bash
cd backend
cp .env.example .env
```
Add your `GEMINI_API_KEY` and `GROQ_API_KEY` to `backend/.env`.

### 2. Backend Setup

```bash
cd backend
python -m venv venv
source venv/Scripts/activate  # On Linux/Mac: source venv/bin/activate
pip install -r requirements.txt
playwright install
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
cd backend
source venv/Scripts/activate
uvicorn app.main:app --reload --port 8000
```

### Start Frontend

```bash
cd frontend
npm run dev
```

The frontend will be available at `http://localhost:3000`.

## Demo Instructions

1. Access the web interface at `http://localhost:3000`.
2. Upload a sample `.csv` or `.xlsx` file containing sparse product data.
3. Observe the batch progress via the dashboard.
4. Click on a product to view the explainable enrichment data (source URL, reasoning, confidence).
5. Address any highlighted validation issues or conflicts.
6. Export the enriched batch to the 252-column Unilog format via the Export page.
