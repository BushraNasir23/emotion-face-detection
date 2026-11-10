# Health Checks and Synthetic Monitoring Implementation Plan

This plan details the implementation of comprehensive health checking and synthetic testing for the AI Calling Bot Dashboard. It adheres to modern SaaS and microservice standards, segregating lightweight load-balancer checks from deep persistence canaries and end-to-end frontend synthetic flows.

---

## Senior Engineer Design & Industry Standards

In production-grade systems, monitoring is divided into specific, isolated layers to ensure stability and actionable alerts:

### 1. Liveness Probe (`/api/health/live/`)
- **Industry Standard**: Orchestrators (like Kubernetes, ECS, or PM2) query this at a high frequency (every 2–5 seconds) to determine if a container is dead and needs to be restarted.
- **Rule**: It must be extremely cheap (response time $<5\text{ms}$). It **must not** query databases, caches, or external APIs. If the database goes down and the liveness probe checks it, the orchestrator will restart the healthy container, leading to a cascading reboot loop.
- **Implementation**: A simple Django view returning `200 OK` instantly with `{"status": "live"}`.

### 2. Readiness Probe (`/api/health/ready/`)
- **Industry Standard**: Load balancers (e.g., AWS ALB, Nginx, Kubernetes Services) query this to decide whether to route traffic to this specific container instance.
- **Rule**: It checks local system resources and direct dependencies. If a dependency (like PostgreSQL or Redis) is unreachable, it returns `503 Service Unavailable`, taking this container out of the routing pool while it recovers.
- **Implementation**: Pings `'default'` database (Postgres), `'vicidial'` database (MySQL), and checks Redis Cache connection.

### 3. Database Write/Read Canary (`/api/health/canary/db/`)
- **Industry Standard**: Pinging a database only verifies network connectivity. It does *not* verify write privileges, disk space constraints, transactional lock contention, or read-write replica lag.
- **Rule**: Run less frequently (e.g., every 1–2 minutes) via uptime monitors or cron jobs.
- **Implementation**: Performs a full lifecycle: writes a timestamp to a dedicated metadata table (`HealthCheckCanary`), reads it back, asserts matching values, and deletes it.

### 4. Call Record Persistence Canary (`/api/health/canary/call/`)
- **Industry Standard**: Domain-specific canary validation checks if the core business model functions correctly.
- **Rule**: Focuses on the system's primary entity (the `Call` model) to verify Django ORM configuration, schema constraints, and database trigger validity.
- **Implementation**: Inserts a mock `Call` record with a unique UUID, fetches it back, validates fields, and deletes it.

### 5. Frontend Synthetic Monitoring
- **Industry Standard**: External agents (e.g., Playwright, Puppeteer, Datadog Synthetics) mimic a real user's browser session. They hit the DNS name, test login page elements, log in using test credentials, and wait for charts/stats to render, catching CSS/JS load failures, CORS blocks, or token expiration issues.
- **Implementation**: 
  - **Option A (API Emulation)**: A Python utility script (`scripts/synthetic_checks.py`) in the backend repository that performs:
    1. A GET request to the frontend URL to check availability.
    2. A POST to `/api/users/login/` with test credentials (synthetic login).
    3. A GET to `/api/users/dashboard/` or stats API using the JWT token to verify dashboard stats load.
  - **Option B (Browser-Based)**: A Playwright browser script inside the frontend repository that boots a headless Chromium instance, performs actual element interaction, and asserts key UI renders.

---

## Proposed Changes

### [Component: Django Backend (`AI-CallingBot-Dashboard-BE`)]

#### [NEW] [models.py](file:///home/ad/ai/AI-CallingBot-Dashboard-BE/health/models.py)
Create a new Django app called `health`. Define a dedicated canary database model:
- `HealthCheckCanary`: containing `id`, `name`, `value`, `created_at`.

#### [NEW] [views.py](file:///home/ad/ai/AI-CallingBot-Dashboard-BE/health/views.py)
Implement views for:
- `LivenessCheckView`: Instantly returns `{"status": "live"}`.
- `ReadinessCheckView`:
  - Pings PostgreSQL ('default').
  - Pings MySQL ('vicidial').
  - Pings Redis (using Django cache backend).
  - Returns `200 OK` or `503 Service Unavailable` with detailed breakdown.
- `DbCanaryView`: Writes, reads, and deletes a `HealthCheckCanary` record.
- `CallCanaryView`: Writes, reads, and deletes a dummy `Call` record.
- `HealthDashboardView`: Aggregated status endpoint combining all checks and reporting latencies.

#### [NEW] [urls.py](file:///home/ad/ai/AI-CallingBot-Dashboard-BE/health/urls.py)
Route the endpoints:
- `/api/health/live/`
- `/api/health/ready/`
- `/api/health/canary/db/`
- `/api/health/canary/call/`
- `/api/health/dashboard/`

#### [MODIFY] [base.py](file:///home/ad/ai/AI-CallingBot-Dashboard-BE/core/settings/base.py)
- Register `'health'` in `INSTALLED_APPS`.

#### [MODIFY] [urls.py](file:///home/ad/ai/AI-CallingBot-Dashboard-BE/core/urls.py)
- Include the `/api/health/` routing.

#### [NEW] [test_health.py](file:///home/ad/ai/AI-CallingBot-Dashboard-BE/tests/test_health.py)
Write integration and unit tests for the liveness, readiness, and canary endpoints using `pytest`.

---

### [Component: Frontend & Synthetic Monitoring (`AI-CallingBot-Dashboard-FE`)]

#### [NEW] [synthetic_tests.py](file:///home/ad/ai/AI-CallingBot-Dashboard-BE/scripts/synthetic_tests.py)
Create a command-line script in Python to execute synthetic checks:
- Verifies frontend availability.
- Performs programmatic login against `/api/users/login/` and asserts token retrieval.
- Fetches main stats/dashboard payload to verify stats load.

#### [NEW] [synthetic.spec.ts](file:///home/ad/ai/AI-CallingBot-Dashboard-FE/tests/synthetic.spec.ts)
Provide an industry-standard browser automation test file using **Playwright**.
- Sets up standard headless Chromium tests.
- Navigates to `/login`, fills credentials, clicks login.
- Validates redirection and presence of dashboard charts/components.

---

## Verification Plan

### Automated Tests
1. **Django App Unit Tests**:
   Run `pytest tests/test_health.py` to assert that all backend endpoints respond correctly and return appropriate status codes (200 for healthy, 503/500 for failures).
2. **Synthetic API Runner**:
   Execute the python synthetic check runner:
   `python scripts/synthetic_tests.py --frontend http://localhost:5174 --backend http://localhost:8000`
3. **Playwright Frontend Synthetic Test**:
   Install playwright: `cd AI-CallingBot-Dashboard-FE && npm install -D @playwright/test`
   Run playwright browser checks: `npx playwright test tests/synthetic.spec.ts`

### Manual Verification
1. Hit endpoints manually using curl or postman:
   - `curl http://localhost:8000/api/health/live/`
   - `curl http://localhost:8000/api/health/ready/`
   - `curl http://localhost:8000/api/health/dashboard/`
2. Stop Redis cache service locally and check that readiness endpoint reports degraded cache state and returns `503`.
