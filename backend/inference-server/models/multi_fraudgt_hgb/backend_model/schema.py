import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT/'assets/schema.json').read_text())
NODE_FEATURES = SCHEMA['node_features']
EDGE_FEATURES = SCHEMA['legacy_edge_features']
NUMERIC_FEATURES = SCHEMA['edge_numeric_features']
FORMAT_NAMES = SCHEMA['payment_formats']
HGB_FEATURES = SCHEMA['hgb_features']
ENTITY_TYPES = SCHEMA['entity_types']
EDGE_DIM = len(NUMERIC_FEATURES) + len(FORMAT_NAMES)
