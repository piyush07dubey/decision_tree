"""
QuantumTree API — Supabase Client

Singleton client initialised from environment variables.
On Vercel, these are set in the project dashboard.
Locally, they are loaded from a .env file.
"""

import os
from functools import lru_cache
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()


@lru_cache(maxsize=1)
def get_client() -> Client:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY", "")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_KEY must be set. "
            "Copy .env.example → .env and fill in your values."
        )
    return create_client(url, key)
