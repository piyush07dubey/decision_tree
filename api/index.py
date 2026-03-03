"""
QuantumTree API — FastAPI Application Entry Point

This file is the Vercel Python serverless function entry point.
Vercel picks up the `app` variable automatically via `@vercel/python`.

Local development:
    uvicorn api.index:app --reload --port 8000
    Then open: http://localhost:8000/docs
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse

from api.routers import datasets, trees

# ── Application ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="QuantumTree API",
    description=(
        "## QuantumTree — ML Decision Tree Visualizer\n\n"
        "Production REST API for storing and retrieving **CART decision tree** sessions "
        "and training datasets. Powered by **FastAPI** + **Supabase** (Postgres). "
        "Deployed as a serverless function on **Vercel**.\n\n"
        "### Key features\n"
        "- Save / load serialised D3-ready tree JSON\n"
        "- Persist uploaded CSV datasets\n"
        "- Anonymous session isolation via browser `session_id`\n"
        "- Numerical & categorical feature support (CART midpoint splits)\n"
    ),
    version="2.0.0",
    contact={"name": "QuantumTree", "url": "https://github.com/piyush07dubey/decision_tree"},
    license_info={"name": "MIT"},
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(datasets.router, prefix="/api/datasets", tags=["QuantumTree — Datasets"])
app.include_router(trees.router,    prefix="/api/trees",    tags=["QuantumTree — Trees"])

# ── Static Files (for local all-in-one running) ───────────────────────────────
# This allows you to run 'fastapi dev api/index.py' and see the UI at http://localhost:8000/
@app.get("/", include_in_schema=False)
async def serve_frontend():
    return FileResponse("tree.html")


# ── Health check ─────────────────────────────────────────────────────────────
@app.get(
    "/api/health",
    tags=["QuantumTree — Meta"],
    name="quantumtree:meta:health",
    summary="API liveness check",
    operation_id="quantumtree_health",
    response_description="Status 'ok' and current API version",
)
async def health():
    """Returns 200 with `{status: ok}` if the API serverless function is running."""
    return {"status": "ok", "version": "2.0.0"}


# ── Root catch-all (Vercel static handles /; this just returns a hint) ────────
@app.get(
    "/api",
    tags=["QuantumTree — Meta"],
    name="quantumtree:meta:root",
    summary="API root — lists available endpoints",
    operation_id="quantumtree_root",
    response_description="Links to docs, health, and version info",
)
async def root():
    return JSONResponse({
        "project":  "QuantumTree ML Decision Tree Visualizer",
        "version":  "2.0.0",
        "docs":     "/api/docs",
        "redoc":    "/api/redoc",
        "health":   "/api/health",
        "datasets": "/api/datasets",
        "trees":    "/api/trees",
    })


# Mount the root directory to serve CSS, JS, and images from the root path.
# This MUST be the last mount/route so it doesn't interfere with /api/ routes.
app.mount("/", StaticFiles(directory="."), name="static")



# ── Global exception handler ─────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {str(exc)}"},
    )
