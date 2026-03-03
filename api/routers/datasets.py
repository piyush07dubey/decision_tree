"""
QuantumTree API — Datasets Router

Endpoints:
  POST   /api/datasets            → save a dataset
  GET    /api/datasets            → list datasets for a session
  GET    /api/datasets/{id}       → fetch one dataset (with full rows)
  DELETE /api/datasets/{id}       → delete a dataset
"""

from uuid import UUID
from fastapi import APIRouter, HTTPException, Query
from api.database import get_client
from api.models import DatasetCreate, DatasetResponse, DatasetListItem

router = APIRouter(tags=["QuantumTree — Datasets"])


# ── POST /api/datasets ────────────────────────────────────────────────────────
@router.post(
    "",
    response_model=DatasetResponse,
    status_code=201,
    name="quantumtree:datasets:create",
    summary="Upload & save a training dataset",
    operation_id="quantumtree_save_dataset",
    response_description="The newly created dataset record with its UUID",
)
async def create_dataset(body: DatasetCreate):
    """
    Save a CSV dataset to Supabase.
    Called by the browser after the user uploads a file or loads sample data.
    """
    db = get_client()

    payload = {
        "session_id":    body.session_id,
        "name":          body.name,
        "headers":       body.headers,
        "rows":          body.rows,
        "feature_types": body.feature_types,
        "row_count":     len(body.rows),
    }

    result = db.table("datasets").insert(payload).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to insert dataset into Supabase")

    return _map_dataset(result.data[0])


# ── GET /api/datasets ─────────────────────────────────────────────────────────
@router.get(
    "/datasets",
    response_model=list[DatasetListItem],
    name="quantumtree:datasets:list",
    summary="List all datasets for this browser session",
    operation_id="quantumtree_list_datasets",
    response_description="Newest-first list of dataset summaries (no full row data)",
)
async def list_datasets(
    session_id: str = Query(..., min_length=1, max_length=128)
):
    """
    Return a lightweight list of all datasets for a given session.
    Ordered newest-first. Does NOT return the full rows array.
    """
    db = get_client()

    result = (
        db.table("datasets")
        .select("id, name, row_count, created_at")
        .eq("session_id", session_id)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )

    return result.data or []


# ── GET /api/datasets/{id} ────────────────────────────────────────────────────
@router.get(
    "/{dataset_id}",
    response_model=DatasetResponse,
    name="quantumtree:datasets:get",
    summary="Fetch a single dataset by ID (includes full row data)",
    operation_id="quantumtree_get_dataset",
    response_description="Full dataset record including all rows and feature types",
)
async def get_dataset(
    dataset_id: UUID,
    session_id: str = Query(..., min_length=1, max_length=128)
):
    """
    Fetch a single dataset by ID.
    Requires matching session_id to prevent cross-session access.
    """
    db = get_client()

    result = (
        db.table("datasets")
        .select("*")
        .eq("id", str(dataset_id))
        .eq("session_id", session_id)
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return _map_dataset(result.data)


# ── DELETE /api/datasets/{id} ─────────────────────────────────────────────────
@router.delete(
    "/{dataset_id}",
    status_code=204,
    name="quantumtree:datasets:delete",
    summary="Delete a dataset (cascades to linked tree sessions)",
    operation_id="quantumtree_delete_dataset",
    response_description="No content — dataset successfully deleted",
)
async def delete_dataset(
    dataset_id: UUID,
    session_id: str = Query(..., min_length=1, max_length=128)
):
    """Delete a dataset. Also cascades to any tree sessions referencing it."""
    db = get_client()

    result = (
        db.table("datasets")
        .delete()
        .eq("id", str(dataset_id))
        .eq("session_id", session_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Dataset not found or access denied")


# ── Helpers ───────────────────────────────────────────────────────────────────
def _map_dataset(row: dict) -> dict:
    """Normalise Supabase row → response dict (handles UUID strings)."""
    return {
        "id":            row["id"],
        "session_id":    row["session_id"],
        "name":          row["name"],
        "headers":       row["headers"],
        "rows":          row.get("rows", []),
        "feature_types": row["feature_types"],
        "row_count":     row["row_count"],
        "created_at":    row["created_at"],
    }
