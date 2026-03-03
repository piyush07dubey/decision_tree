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
from api.database import get_client
from api.models import TreeSessionCreate, TreeSessionResponse, TreeSessionListItem

router = APIRouter(tags=["QuantumTree — Trees"])


# ── POST /api/trees ───────────────────────────────────────────────────────────
@router.post(
    "/trees",
    response_model=TreeSessionResponse,
    status_code=201,
    name="quantumtree:trees:save",
    summary="Save a built CART decision tree session",
    operation_id="quantumtree_save_tree",
    response_description="The persisted tree session record with UUID and metadata",
)
async def save_tree(body: TreeSessionCreate):
    """
    Persist a built decision tree to Supabase.
    Called by the browser after buildTree() completes.
    The full serialised tree_json (the JS root node as a dict) is stored.
    """
    db = get_client()

    payload = {
        "session_id":   body.session_id,
        "dataset_id":   str(body.dataset_id) if body.dataset_id else None,
        "dataset_name": body.dataset_name,
        "criterion":    body.criterion,
        "max_depth":    body.max_depth,
        "min_samples":  body.min_samples,
        "tree_json":    body.tree_json,
        "stats":        body.stats,
    }

    result = db.table("tree_sessions").insert(payload).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to save tree session")

    return _map_session(result.data[0])


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
    db = get_client()

    result = (
        db.table("tree_sessions")
        .select("id, dataset_name, criterion, max_depth, min_samples, stats, created_at")
        .eq("session_id", session_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )

    return result.data or []


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
    db = get_client()

    result = (
        db.table("tree_sessions")
        .select("*")
        .eq("id", str(tree_id))
        .eq("session_id", session_id)
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Tree session not found")

    return _map_session(result.data)


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
    db = get_client()

    result = (
        db.table("tree_sessions")
        .delete()
        .eq("id", str(tree_id))
        .eq("session_id", session_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Tree session not found or access denied")


# ── Helpers ───────────────────────────────────────────────────────────────────
def _map_session(row: dict) -> dict:
    return {
        "id":           row["id"],
        "session_id":   row.get("session_id", ""),
        "dataset_id":   row.get("dataset_id"),
        "dataset_name": row["dataset_name"],
        "criterion":    row["criterion"],
        "max_depth":    row["max_depth"],
        "min_samples":  row["min_samples"],
        "tree_json":    row.get("tree_json", {}),
        "stats":        row["stats"],
        "created_at":   row["created_at"],
    }
