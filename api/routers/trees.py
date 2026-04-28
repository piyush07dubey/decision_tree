"""
QuantumTree API — Tree Sessions Router

Endpoints:
  POST   /api/trees               → save a built tree
  GET    /api/trees               → list tree history for a session
  GET    /api/trees/{id}          → fetch one full tree session
  DELETE /api/trees/{id}          → delete a tree session
"""

from uuid import UUID
from fastapi import APIRouter, HTTPException, Query
from api.database import get_db
from api.models import TreeSessionCreate, TreeSessionResponse, TreeSessionListItem

router = APIRouter(tags=["QuantumTree — Trees"])


# ── POST /api/trees ───────────────────────────────────────────────────────────
@router.post(
    "",
    response_model=TreeSessionResponse,
    status_code=201,
    name="quantumtree:trees:save",
    summary="Save a built CART decision tree session",
    operation_id="quantumtree_save_tree",
    response_description="The persisted tree session record with UUID and metadata",
)
async def save_tree(body: TreeSessionCreate):
    """
    Persist a built decision tree to MongoDB.
    Called by the browser after buildTree() completes.
    The full serialised tree_json (the JS root node as a dict) is stored.
    """
    db = get_db()

    document = {
        "session_id":   body.session_id,
        "dataset_id":   body.dataset_id if body.dataset_id else None,
        "dataset_name": body.dataset_name,
        "criterion":    body.criterion,
        "max_depth":    body.max_depth,
        "min_samples":  body.min_samples,
        "tree_json":    body.tree_json,
        "stats":        body.stats,
        "created_at":   None,  # Will be set by MongoDB
    }

    result = db.tree_sessions.insert_one(document)

    if not result.inserted_id:
        raise HTTPException(status_code=500, detail="Failed to save tree session")

    # Fetch the inserted document to get the created_at timestamp
    inserted_doc = db.tree_sessions.find_one({"_id": result.inserted_id})

    return _map_session(inserted_doc)


# ── GET /api/trees ────────────────────────────────────────────────────────────
@router.get(
    "",
    response_model=list[TreeSessionListItem],
    name="quantumtree:trees:list",
    summary="List tree build history for this browser session",
    operation_id="quantumtree_list_trees",
    response_description="Newest-first list of tree session cards (no heavy tree_json payload)",
)
async def list_trees(
    session_id: str = Query(..., min_length=1, max_length=128),
    limit: int = Query(20, ge=1, le=100),
):
    """
    Return card-level history of tree sessions for a given browser session.
    Does NOT include tree_json in the list (too large); only stats + metadata.
    """
    db = get_db()

    cursor = (
        db.tree_sessions
        .find({"session_id": session_id})
        .sort("created_at", -1)  # Descending order (newest first)
        .limit(limit)
    )

    results = []
    for doc in cursor:
        results.append({
            "id": doc["_id"],
            "dataset_name": doc["dataset_name"],
            "criterion": doc["criterion"],
            "max_depth": doc["max_depth"],
            "min_samples": doc["min_samples"],
            "stats": doc["stats"],
            "created_at": doc["created_at"],
        })

    return results


# ── GET /api/trees/{id} ───────────────────────────────────────────────────────
@router.get(
    "/{tree_id}",
    response_model=TreeSessionResponse,
    name="quantumtree:trees:get",
    summary="Load a full tree session for D3 re-render (no rebuild needed)",
    operation_id="quantumtree_get_tree",
    response_description="Full tree session including the serialised tree_json root node",
)
async def get_tree(
    tree_id: UUID,
    session_id: str = Query(..., min_length=1, max_length=128),
):
    """
    Fetch a full tree session (including tree_json) so the browser can
    re-render a previously built tree without re-running the algorithm.
    """
    db = get_db()

    doc = db.tree_sessions.find_one({
        "_id": tree_id,
        "session_id": session_id
    })

    if not doc:
        raise HTTPException(status_code=404, detail="Tree session not found")

    return _map_session(doc)


# ── DELETE /api/trees/{id} ────────────────────────────────────────────────────
@router.delete(
    "/{tree_id}",
    status_code=204,
    name="quantumtree:trees:delete",
    summary="Delete a saved tree session from history",
    operation_id="quantumtree_delete_tree",
    response_description="No content — tree session successfully removed",
)
async def delete_tree(
    tree_id: UUID,
    session_id: str = Query(..., min_length=1, max_length=128),
):
    """Remove a saved tree session."""
    db = get_db()

    result = db.tree_sessions.delete_one({
        "_id": tree_id,
        "session_id": session_id
    })

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tree session not found or access denied")


# ── Helpers ───────────────────────────────────────────────────────────────────
def _map_session(doc: dict) -> dict:
    """Normalise MongoDB document → response dict."""
    return {
        "id":           doc["_id"],
        "session_id":   doc.get("session_id", ""),
        "dataset_id":   doc.get("dataset_id"),
        "dataset_name": doc["dataset_name"],
        "criterion":    doc["criterion"],
        "max_depth":    doc["max_depth"],
        "min_samples":  doc["min_samples"],
        "tree_json":    doc.get("tree_json", {}),
        "stats":        doc["stats"],
        "created_at":   doc["created_at"],
    }