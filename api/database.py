"""QuantumTree API — MongoDB Client

Singleton client initialised from environment variables.
On Vercel, these are set in the project dashboard.
Locally, they are loaded from a .env file.
"""

import os
from datetime import datetime
from functools import lru_cache
from typing import Optional
from pymongo import MongoClient
from pymongo.database import Database
from dotenv import load_dotenv

load_dotenv()


class MongoDBClient:
    """MongoDB client wrapper for QuantumTree API."""
    
    def __init__(self):
        uri = os.environ.get("MONGODB_URI", "")
        db_name = os.environ.get("DB_NAME", "quantumtree")
        
        if not uri:
            raise RuntimeError(
                "MONGODB_URI must be set. "
                "Copy .env.example → .env and fill in your values."
            )
        
        self.client = MongoClient(uri)
        self.db: Database = self.client[db_name]
        
        # Create indexes for optimal query performance
        self._create_indexes()
    
    def _create_indexes(self):
        """Create indexes for optimal query performance."""
        # Datasets indexes
        self.db.datasets.create_index("session_id")
        self.db.datasets.create_index("created_at", background=True)
        
        # Tree sessions indexes
        self.db.tree_sessions.create_index("session_id")
        self.db.tree_sessions.create_index("created_at", background=True)
    
    def close(self):
        """Close the MongoDB connection."""
        if self.client:
            self.client.close()


# Singleton instance
_mongo_client: Optional[MongoDBClient] = None


@lru_cache(maxsize=1)
def get_client() -> MongoDBClient:
    """Get or create the MongoDB client singleton."""
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = MongoDBClient()
    return _mongo_client


def get_db() -> Database:
    """Get the MongoDB database instance."""
    return get_client().db