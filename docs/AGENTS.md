# AGENTS.md — Coding Agent Rules & Project Architecture
# AI-Powered Product Intelligence for Industrial Commerce

**Version:** 2.0
**MANDATORY READING for any AI coding assistant working on this codebase.**

---

## 1. Project Identity

This is a hackathon MVP that ingests sparse 6-column product rows and produces
252-column Unilog delivery format records using a 6-agent AI pipeline.

**What this is:** A data enrichment system with explainability and self-validation.
**What this is NOT:** A generic chatbot, a product recommendation engine, an e-commerce store,
                      or an electrical-component analyzer.

Do NOT add features that are not in the PRD. Do NOT change the domain.

---

## 2. Architecture Rules — NEVER Violate

- NEVER replace SQLite with any other database (MySQL, PostgreSQL, MongoDB) without explicit instruction.
- NEVER add Redis, Celery, RabbitMQ, or any message queue. Use FastAPI BackgroundTasks.
- NEVER add authentication, sessions, JWT tokens, OAuth, or user management. Out of scope.
- NEVER add Docker unless explicitly asked.
- NEVER call Gemini or Groq APIs directly from routers. All LLM calls go through LLMRouter.
- NEVER merge agents. The 6-agent chain (Scraper, Classifier, Extractor, Normalizer, Writer, Validator) is canonical.
- NEVER skip agents in the pipeline. Even if an agent returns minimal data, it must run.
- NEVER hardcode product categories or attribute lists. The Extractor is dynamic by design.
- NEVER modify the 252-column Unilog delivery format headers. They are fixed.
- NEVER add a frontend state management library (Redux, Zustand, MobX) — React Query handles all server state.

---

## 3. File Structure (Canonical — Do Not Reorganize)

```
ai-product-intelligence/
+-- backend/
|   +-- app/
|   |   +-- main.py              # FastAPI app, CORS, router registration
|   |   +-- config.py            # Pydantic settings from .env
|   |   +-- database.py          # SQLAlchemy async engine + session factory
|   |   +-- models/              # SQLAlchemy ORM models (one file per table)
|   |   |   +-- product.py
|   |   |   +-- enriched_field.py
|   |   |   +-- enriched_record.py
|   |   |   +-- validation_issue.py
|   |   |   +-- scrape_cache.py
|   |   |   +-- ingestion_job.py
|   |   +-- schemas/             # Pydantic request/response schemas
|   |   |   +-- product.py
|   |   |   +-- enrichment.py
|   |   |   +-- export.py
|   |   +-- routers/             # FastAPI routers (one per resource)
|   |   |   +-- upload.py
|   |   |   +-- products.py
|   |   |   +-- export.py
|   |   |   +-- stats.py
|   |   +-- agents/              # The 6 pipeline agents
|   |   |   +-- __init__.py
|   |   |   +-- orchestrator.py  # Chains all 6 agents, writes results to DB
|   |   |   +-- scraper.py       # Agent 1: httpx + playwright
|   |   |   +-- classifier.py    # Agent 2: Groq classpath
|   |   |   +-- extractor.py     # Agent 3: Gemini attribute extraction
|   |   |   +-- normalizer.py    # Agent 4: Rules + LLM brand canonicalization
|   |   |   +-- writer.py        # Agent 5: Gemini description generation
|   |   |   +-- validator.py     # Agent 6: Pure deterministic validation
|   |   +-- services/
|   |   |   +-- llm_router.py    # Central LLM routing + rate limit tracking
|   |   |   +-- export_service.py # 252-col CSV assembly
|   |   +-- utils/
|   |       +-- text_cleaner.py  # HTML stripping, text normalization
|   |       +-- validation_rules.py # Char limits, UOM regex, casing rules
|   +-- uploads/                 # Uploaded CSV files stored here
|   +-- products.db              # SQLite database file
|   +-- requirements.txt
|   +-- .env
+-- frontend/
    +-- src/
    |   +-- components/
    |   |   +-- ui/              # shadcn/ui components (do not edit)
    |   |   +-- ProductTable.tsx
    |   |   +-- ConfidenceBadge.tsx
    |   |   +-- ExplainabilityDrawer.tsx
    |   |   +-- DiffView.tsx
    |   |   +-- ConflictCard.tsx
    |   |   +-- UploadDropzone.tsx
    |   |   +-- BatchProgress.tsx
    |   +-- pages/
    |   |   +-- Dashboard.tsx    # / route
    |   |   +-- UploadPage.tsx   # /upload route
    |   |   +-- ProductDetail.tsx # /products/:id route
    |   |   +-- ExportPage.tsx   # /export route
    |   +-- lib/
    |   |   +-- api.ts           # ALL axios API calls here (no inline URLs)
    |   |   +-- constants.ts     # API_BASE_URL, confidence thresholds, etc.
    |   |   +-- utils.ts         # Helper functions
    |   +-- hooks/
    |       +-- useJobStatus.ts  # Polling hook for single product job
    |       +-- useBatchProgress.ts # Polling hook for batch
    +-- package.json
    +-- .env                     # VITE_API_BASE_URL=http://localhost:8000
```

---

## 4. Coding Standards

### Python (Backend)
- Type hints on EVERY function parameter and return value.
- async/await for ALL I/O operations (database, HTTP, file I/O).
- All agents return typed Pydantic models — never return raw dicts.
- Use Python logging module — NEVER use print() in production code.
- Error handling: catch specific exceptions, log them, re-raise or return graceful fallback.
- Never silently swallow exceptions with bare `except: pass`.
- Use `uuid.uuid4()` for all ID generation.
- Database sessions: always use `async with` context manager.

### TypeScript (Frontend)
- Functional components only — no class components.
- All API calls go through `src/lib/api.ts` — never inline fetch/axios calls in components.
- Never hardcode `http://localhost:8000` in components — use `constants.ts`.
- Use TanStack Query (useQuery, useMutation) for all server state.
- No direct DOM manipulation — React handles the DOM.
- Props must have TypeScript interfaces.

---

## 5. What NOT To Do

### Architecture
- Do not add WebSockets — polling every 2 seconds is correct and sufficient.
- Do not add a caching layer (Redis) — SQLite scrape_cache is the cache.
- Do not add a task queue — BackgroundTasks handles async pipeline execution.
- Do not add microservices — this is a monolith for good reason (3-day hackathon).

### AI / Enrichment
- Do not fake AI output. If a field cannot be extracted, return null + low confidence.
- Do not claim commerce_ready=true without running the ValidatorAgent logic.
- Do not skip the NormalizerAgent. Raw LLM output often has UOM formatting issues.
- Do not assume the attribute list is fixed. ExtractorAgent must be fully dynamic.
- Do not log full scraped page content — it may contain PII or be very large.
- Do not store API keys in code — only in .env.

### Code Quality
- Do not add placeholder comments like "TODO: implement this" in working code.
- Do not copy-paste agent code — each agent inherits from a base class.
- Do not add unnecessary dependencies. Check if stdlib or existing deps solve it first.
- Do not refactor files unrelated to the current task.
- Do not break working functionality when fixing bugs.
- Do not add logging that exposes GEMINI_API_KEY or GROQ_API_KEY.

### UI
- Do not add authentication UI — no login, signup, or profile pages.
- Do not build the shadcn-admin calendar, kanban, or chat pages.
- Do not make mobile-specific layouts (desktop only for hackathon).
- Do not add animations that slow down the demo.

---

## 6. Agent Implementation Rules

```python
# All agents must follow this pattern:

from abc import ABC, abstractmethod
from pydantic import BaseModel

class BaseAgent(ABC):
    """Base class for all pipeline agents."""

    def __init__(self, llm_router=None, db_session=None):
        self.llm = llm_router
        self.db = db_session

    @abstractmethod
    async def run(self, input_data: BaseModel) -> BaseModel:
        """Execute the agent. Must be async. Must return typed Pydantic model."""
        pass

    async def _log_event(self, product_id: str, event_type: str, message: str):
        """Write a progress event to ingestion_jobs table."""
        pass
```

**Rules:**
1. Each agent file exports exactly one class: `class [Name]Agent(BaseAgent)`.
2. Each agent implements `async def run(self, input: AgentInput) -> AgentOutput`.
3. Each agent handles its own retry logic internally (do not retry in the orchestrator).
4. Agents must NOT call other agents — the Orchestrator manages the chain.
5. Every agent start/complete/fail event must be logged via `_log_event`.
6. If an agent fails after retries, it raises an exception — the Orchestrator catches it.

---

## 7. LLMRouter Rules

```python
# The ONLY class allowed to call Gemini or Groq APIs.
class LLMRouter:
    # Routing logic (DO NOT override from outside):
    # - Extractor, Writer -> Gemini 2.0 Flash (long context, quality)
    # - Classifier -> Groq Llama 3.3 70B (fast, short context)
    # - On Gemini 429 -> exponential backoff -> Groq fallback
    # - Tracks daily call counts in app_config SQLite table
    # - Logs which model was used for every call
```

**Rules:**
- LLMRouter must track `gemini_calls_today` and `groq_calls_today` in the DB.
- Daily counts must reset at midnight (check `last_reset_date` in app_config).
- When Gemini calls today >= 195: automatically route to Groq.
- Always log the model used: `logger.info(f"LLM call: model={model}, tokens_est={n}")`.
- Temperature must be 0.1 for all enrichment calls (consistency over creativity).
- Always request JSON output (`response_mime_type="application/json"` for Gemini).

---

## 8. Demo Stability Rules

These rules exist to prevent failures during the judge demo:

1. **scrape_cache MUST be checked before any live scraping.** Cache hit = instant response.
2. **Pre-populate scrape_cache** for 20 demo products before demo day (run a pre-enrichment pass).
3. **Never let a single product failure break a batch.** Orchestrator catches all exceptions per product.
4. **Graceful degradation:** If scraping fails, continue pipeline with part_desc as the text source.
5. **Playwright must have a timeout of 10 seconds.** Never block indefinitely.
6. **The export endpoint must always work** even if some fields are empty strings.
7. **Validation issues should not block export** — they are informational flags.

---

## 9. Judging Criteria Alignment

The following are direct requirements from hackathon judging. Every implementation decision must support these:

| Criterion | Implementation Requirement |
|---|---|
| Field-level accuracy | EnrichedField.confidence must correlate with actual correctness |
| Char-limit compliance | ValidatorAgent must check every description field against CHAR_LIMITS |
| UOM compliance | NormalizerAgent must apply UOM_CORRECTIONS before ValidatorAgent runs |
| Brand canonicalization | NormalizerAgent must apply KNOWN_BRANDS_WITH_SYMBOLS |
| Explainability | Every EnrichedField must have source_url + source_snippet + reasoning |
| Confidence scores | Must be computed per the formula in AI_PIPELINE.md, not arbitrary |
| Commerce-ready logic | Must be deterministic and match the gate conditions in TRD |
| Export format | Must use exact 252-column Unilog headers from expected output CSV |
| Diff view | GET /api/products/{id}/diff must always return both input and output |
| Depth over breadth | Pipeline must produce high-quality output for the demo products |
