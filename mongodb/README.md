# QuantumTree — MongoDB Schema

This directory contains documentation for the MongoDB schema used by QuantumTree.

## Collections

### `datasets`

Stores uploaded CSV datasets with their metadata.

```javascript
{
  _id: ObjectId,                    // Unique identifier
  session_id: string,               // Browser session identifier
  name: string,                     // Dataset name
  headers: [string],                // Column names ["col1", "col2", ..., "label"]
  rows: [[any]],                    // 2D array of data rows
  feature_types: {                  // Feature type mapping
    [columnName]: "numerical" | "categorical"
  },
  row_count: number,                // Number of rows
  created_at: Date                  // Creation timestamp
}
```

**Indexes:**
- `session_id` — For fast session-scoped lookups
- `created_at` — For sorting by creation date

### `tree_sessions`

Stores built decision tree sessions with their configuration and serialized tree.

```javascript
{
  _id: ObjectId,                    // Unique identifier
  session_id: string,               // Browser session identifier
  dataset_id: ObjectId | null,      // Reference to datasets._id
  dataset_name: string,             // Denormalized dataset name for list view
  criterion: "entropy" | "gini",    // Split criterion
  max_depth: number,                // Maximum tree depth (1-20)
  min_samples: number,              // Minimum samples per leaf (>=2)
  tree_json: object,                // Serialized tree root node (D3-ready)
  stats: {
    nodes: number,                  // Total nodes in tree
    leaves: number,                 // Leaf nodes count
    maxDepth: number                // Actual max depth
  },
  created_at: Date                  // Creation timestamp
}
```

**Indexes:**
- `session_id` — For fast session-scoped lookups
- `created_at` — For sorting by creation date (newest first)

## Setup Instructions

### 1. Create MongoDB Atlas Cluster

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free cluster (M0)
3. Create a database user with read/write permissions
4. Whitelist your IP address (or 0.0.0.0/0 for development)

### 2. Get Connection String

1. Click "Connect" on your cluster
2. Choose "Connect your application"
3. Copy the connection string
4. Replace `<password>` with your database user password

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and update:

```bash
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/quantumtree?retryWrites=true&w=majority
DB_NAME=quantumtree
```

### 4. Install Dependencies

```bash
pip install -r requirements.txt
```

### 5. Run the Application

```bash
# Local development
uvicorn api.index:app --reload --port 8000

# Open browser to http://localhost:8000
```

## Data Cleanup

Unlike the Supabase version with its automatic cleanup function, you may want to set up a cron job or MongoDB Atlas trigger to clean up old sessions:

```javascript
// MongoDB Atlas Trigger or scheduled job
db.datasets.deleteMany({ created_at: { $lt: new Date(Date.now() - 30*24*60*60*1000) } });
db.tree_sessions.deleteMany({ created_at: { $lt: new Date(Date.now() - 30*24*60*60*1000) } });
```

This removes sessions older than 30 days.