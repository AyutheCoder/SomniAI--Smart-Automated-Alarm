"""Tests for the minimal BSON reader.

It exists because LifeSnaps hides sleep timing in a 9.7 GB mongodump and
pymongo is not a dependency. If it misreads a field, every downstream number is
wrong with no other symptom, so it is checked against an independently written
encoder rather than against recorded bytes.
"""

from __future__ import annotations

import io

import pytest

from datasets import bson_stream

from .bson_fixtures import encode_document, encode_stream, sleep_document


def test_round_trips_every_type_the_dump_contains():
    doc = {
        "_id": "62cc2021b41dcd4b1bfe9383",
        "count": 42,
        "big": 32408388976,
        "ratio": 0.5,
        "name": "sleep",
        "flag": True,
        "off": False,
        "missing": None,
        "nested": {"a": 1, "b": "two"},
        "list": [1, 2, 3],
    }
    got = bson_stream.decode(encode_document(doc))
    assert got == doc


def test_reads_a_sequence_of_documents():
    docs = [{"i": i, "name": f"doc{i}"} for i in range(5)]
    stream = io.BytesIO(encode_stream(docs))
    assert [d["i"] for d in bson_stream.iter_documents(stream)] == [0, 1, 2, 3, 4]


def test_filter_skips_decoding_without_losing_matches():
    docs = [
        {"type": "heart", "bpm": 60},
        sleep_document("p1", "2021-06-02", "2021-06-01T23:58:30.000", "2021-06-02T09:32:30.000"),
        {"type": "steps", "value": 100},
    ]
    stream = io.BytesIO(encode_stream(docs))
    got = list(bson_stream.iter_documents(stream, where=lambda raw: b"dateOfSleep" in raw))
    assert len(got) == 1
    assert got[0]["data"]["dateOfSleep"] == "2021-06-02"


def test_preserves_unicode():
    doc = bson_stream.decode(encode_document({"note": "café — sleép"}))
    assert doc["note"] == "café — sleép"


def test_stops_cleanly_at_end_of_stream():
    assert list(bson_stream.iter_documents(io.BytesIO(b""))) == []


def test_stops_rather_than_crashing_on_a_truncated_tail():
    # A partially-written dump should yield what is intact, not raise.
    data = encode_stream([{"i": 1}, {"i": 2}])
    stream = io.BytesIO(data[:-4])
    got = list(bson_stream.iter_documents(stream))
    assert [d["i"] for d in got] == [1]


def test_rejects_an_implausible_length_header():
    with pytest.raises(bson_stream.BSONError):
        list(bson_stream.iter_documents(io.BytesIO(b"\x02\x00\x00\x00")))


def test_rejects_a_document_whose_length_disagrees_with_its_content():
    raw = bytearray(encode_document({"a": 1}))
    raw[0] += 4  # claim more bytes than are present
    with pytest.raises(bson_stream.BSONError):
        bson_stream.decode(bytes(raw))
