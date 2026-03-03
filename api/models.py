"""
QuantumTree API — Pydantic Models

All request bodies and response shapes are validated here.
Keeps routers clean and gives automatic OpenAPI docs.
"""

from __future__ import annotations
from datetime import datetime
from typing import Any
from uuid import UUID
from pydantic import BaseModel, Field, field_validator


# ─── Dataset models ───────────────────────────────────────────────────────────

class DatasetCreate(BaseModel):
    """
    Payload sent by the browser when saving a CSV dataset.
    `headers` is the full list of column names (last one is the label).
    `rows` is a 2-D list: each inner list is one data row.
    `feature_types` maps each feature name to 'numerical' or 'categorical'.
    """
    session_id:    str             = Field(..., min_length=1, max_length=128)
    name:          str             = Field(..., min_length=1, max_length=255)
    headers:       list[str]       = Field(..., min_length=2)
    rows:          list[list[Any]] = Field(..., min_length=1)
    feature_types: dict[str, str]  = Field(...)

    @field_validator("feature_types")
    @classmethod
    def validate_feature_types(cls, v: dict[str, str]) -> dict[str, str]:
        allowed = {"numerical", "categorical"}
        for col, t in v.items():
            if t not in allowed:
                raise ValueError(f"feature_type for '{col}' must be 'numerical' or 'categorical'")
        return v


class DatasetResponse(BaseModel):
    id:            UUID
    session_id:    str
    name:          str
    headers:       list[str]
    rows:          list[list[Any]]
    feature_types: dict[str, str]
    row_count:     int
    created_at:    datetime


class DatasetListItem(BaseModel):
    """Lightweight summary for list views — does NOT include the full rows array."""
    id:         UUID
    name:       str
    row_count:  int
    created_at: datetime


# ─── Tree session models ───────────────────────────────────────────────────────

class TreeSessionCreate(BaseModel):
    """
    Payload sent by the browser after building a tree.
    `tree_json` is the full serialised tree root (the JS object) as a dict.
    `stats` is {nodes, leaves, maxDepth}.
    """
    session_id:   str         = Field(..., min_length=1, max_length=128)
    dataset_id:   UUID | None = Field(None, description="UUID of the saved dataset, if any")
    dataset_name: str         = Field(..., min_length=1, max_length=255)
    criterion:    str         = Field(..., pattern="^(entropy|gini)$")
    max_depth:    int         = Field(..., ge=1, le=20)
    min_samples:  int         = Field(..., ge=2)
    tree_json:    dict        = Field(...)
    stats:        dict        = Field(...)

    @field_validator("stats")
    @classmethod
    def validate_stats(cls, v: dict) -> dict:
        for key in ("nodes", "leaves", "maxDepth"):
            if key not in v:
                raise ValueError(f"stats must include '{key}'")
        return v


class TreeSessionResponse(BaseModel):
    id:           UUID
    session_id:   str
    dataset_id:   UUID | None
    dataset_name: str
    criterion:    str
    max_depth:    int
    min_samples:  int
    tree_json:    dict
    stats:        dict
    created_at:   datetime


class TreeSessionListItem(BaseModel):
    """Card data for the history sidebar — no full tree_json."""
    id:           UUID
    dataset_name: str
    criterion:    str
    max_depth:    int
    min_samples:  int
    stats:        dict
    created_at:   datetime
