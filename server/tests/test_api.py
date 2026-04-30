import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}

def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "ReturnGuard API online" in data["status"]
    assert data["fraud_vectors"] == 6

def test_demo_scenarios():
    response = client.get("/api/demo/scenarios")
    assert response.status_code == 200
    data = response.json()
    assert "scenarios" in data
    assert len(data["scenarios"]) >= 5
    
    keys = [s["key"] for s in data["scenarios"]]
    assert "maya_legit" in keys
    assert "wardrobing" in keys
    assert "friendly_fraud" in keys
