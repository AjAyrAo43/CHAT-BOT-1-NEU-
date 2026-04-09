"""
backend/main.py  (shim — do not add logic here)
------------------------------------------------
Backward-compatible entry point.

The full application now lives in backend/app/.
This file simply re-exports `app` so that existing uvicorn / Render / Cloud Run
start commands remain unchanged:

    uvicorn backend.main:app --reload
"""
from .app.main import app  # noqa: F401  — re-export for uvicorn

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
