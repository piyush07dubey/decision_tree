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
from api.database import get_db
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
    Save a CSV dataset to MongoDB.
    Called by the browser after the user uploads a file or loads sample data.
    """
    db = get_db()

    from bson import uuid

    document = {
        "session_id":    body.session_id,
        "name":          body.name,
        "headers":       body.headers,
        "rows":          body.rows,
        "feature_types": body.feature_types,
        "row_count":     len(body.rows),
        "created_at":    None,  # Will be set by MongoDB
    }

    result = db.datasets.insert_one(document)

    if not result.inserted_id:
        raise HTTPException(status_code=500, detail="Failed to insert dataset into MongoDB")

    # Fetch the inserted document to get the created_at timestamp
    inserted_doc = db.datasets.find_one({"_id": result.inserted_id})

    return _map_dataset(inserted_doc)


# ── GET /api/datasets ─────────────────────────────────────────────────────────
@router.get(
    "",
    response_model=list[DatasetListItem],
    name="quantumtree:datasets:list",
    summary="List all datasets for this browser session",
    operation_id="quantumtree_list_datasets",
    response_description="Newest-first list of dataset summaries (no full rows array)",
)
async def list_datasets(
    session_id: str = Query(..., min_length=1, max_length=128)
):
    """
    Return a lightweight list of all datasets for a given session.
    Ordered newest-first. Does NOT return the full rows array.
    """
    db = get_db()

    cursor = (
        db.datasets
        .find({"session_id": session_id})
        .sort("created_at", -1)  # Descending order (newest first)
        .limit(50)
    )

    results = []
    for doc in cursor:
        results.append({
            "id": doc["_id"],
            "name": doc["name"],
            "row_count": doc["row_count"],
            "created_at": doc["created_at"],
        })

    return results


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
    db = get_db()

    doc = db.datasets.find_one({
        "_id": dataset_id,
        "session_id": session_id
    })

    if not doc:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return _map_dataset(doc)


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
    db = get_db()

    result = db.datasets.delete_one({
        "_id": dataset_id,
        "session_id": session_id
    })

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Dataset not found or access denied")

    # Cascade delete: remove tree sessions that reference this dataset
    db.tree_sessions.delete_many({"dataset_id": dataset_id})


# ── Helpers ───────────────────────────────────────────────────────────────────
def _map_dataset(doc: dict) -> dict:
    """Normalise MongoDB document → response dict (handles ObjectId to UUID)."""
    return {
        "id":            doc["_id"],
        "session_id":    doc["session_id"],
        "name":          doc["name"],
        "headers":       doc["headers"],
        "rows":          doc.get("rows", []),
        "feature_types": doc["feature_types"],
        "row_count":     doc["row_count"],
        "created_at":    doc["created_at"],
    }