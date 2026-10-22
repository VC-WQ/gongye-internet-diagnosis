"""Service import stays lightweight; on-demand model behavior keeps its contract."""
import concurrent.futures
import json
import os
import subprocess
import sys


def test_service_import_does_not_import_torch():
    code = "import sys,json; import app.main; print(json.dumps({'torch':'torch' in sys.modules}))"
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    assert json.loads(result.stdout.splitlines()[-1])["torch"] is False


def test_concurrent_first_use_reuses_singletons():
    from app.modules.anomaly_detect.service import AnomalyDetectService
    service = AnomalyDetectService()
    assert service._cnn is None and service._pinn is None
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        instances = list(pool.map(lambda _: (service.cnn, service.pinn), range(8)))
    assert all(cnn is instances[0][0] and pinn is instances[0][1] for cnn, pinn in instances)
    result = service.detect("test-device", [{"vibration": .1, "speed": 1797} for _ in range(2048)])
    assert result["device_id"] == "test-device"
    assert result["cnn_source"] in {"trained_model", "model_unavailable", "heuristic"}
    assert 0 <= result["health"]["health_score"] <= 100


def test_model_listing_has_no_hidden_warmup(monkeypatch):
    from app.modules.vision.router import list_models
    from app.modules.vision.service import vision_service
    monkeypatch.setattr(vision_service, "prewarm", lambda *_: (_ for _ in ()).throw(AssertionError("unexpected warmup")))
    assert isinstance(list_models()["models"], list)


def test_failed_vision_load_can_retry_without_cached_failure(tmp_path, monkeypatch):
    from app.modules.vision import service
    instance = service.VisionService()
    monkeypatch.setattr(service, "WEIGHT_DIR", str(tmp_path))
    for _ in range(2):
        try:
            instance._get_model("yolov8s")
            assert False
        except FileNotFoundError:
            pass
        assert not instance._models


def test_real_torch_forward_with_labelled_checkpoint_fixture(tmp_path, monkeypatch):
    """Exercises actual torch inference, not a claim about production model accuracy."""
    import numpy as np
    import torch
    from app.modules.anomaly_detect import cnn_classifier as cnn
    from app.modules.anomaly_detect import pinn_residual as pinn
    torch.manual_seed(26)
    classifier = cnn.FaultClassifier()
    generator = pinn.PinnResidualGenerator()
    cnn_path = tmp_path / "fixture-cnn.pt"
    pinn_path = tmp_path / "fixture-pinn.pt"
    classifier.save(str(cnn_path))
    generator.save(str(pinn_path))
    assert classifier.ensure_weights(str(cnn_path))
    assert generator.ensure_weights(str(pinn_path))
    result = classifier.classify(np.zeros((1, 1, 2048), dtype=np.float32))
    physical = generator.compute_residual([{"vibration": .1} for _ in range(2048)])
    assert result["cnn_source"] == "trained_model"
    assert physical["pinn_source"] == "trained_model"
    assert abs(sum(result["probabilities"].values()) - 1) < .001


def test_missing_torch_retains_fallback():
    code = "import sys,json; sys.modules['torch']=None; from app.modules.anomaly_detect.service import anomaly_detect_service; r=anomaly_detect_service.detect('test', [{'vibration':.1}]*2048); print(json.dumps({'cnn':r['cnn_source'],'pinn':r['pinn_source']}))"
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    output = json.loads(result.stdout.splitlines()[-1])
    assert output["cnn"] == "model_unavailable"
    assert output["pinn"] != "trained_model"
