"""Real-world dataset loaders for the SomniAI models.

Every loader emits the same person-night schema (see `schema.py`), so training
code is dataset-agnostic. Features a dataset cannot supply are present and NaN
rather than absent.

    from datasets import pmdata, lifesnaps, schema

    df = pmdata.load("/path/to/pmdata")
    print(schema.completeness(df))
"""

from . import bson_stream, cache, derive, lifesnaps, pmdata, schema, wake_proxy

__all__ = ["bson_stream", "cache", "derive", "lifesnaps", "pmdata", "schema", "wake_proxy"]
